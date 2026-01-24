const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const crypto = require('crypto');
// Note: Using native fetch (Node.js 18+)

// Paystack Secret Key from environment
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_PUBLIC_KEY = process.env.PAYSTACK_PUBLIC_KEY;

// Generate unique transaction reference
function generateReference() {
    const timestamp = Date.now().toString(36);
    const random = crypto.randomBytes(4).toString('hex');
    return `HP-${timestamp}-${random}`.toUpperCase();
}

// Initialize payment transaction
router.post('/initialize', async (req, res) => {
    try {
        const {
            email,
            amount, // Amount in the currency (will convert to kobo/pesewas)
            currency = 'NGN', // NGN, GHS, ZAR, USD
            metadata = {},
            callback_url
        } = req.body;

        if (!email || !amount) {
            return res.status(400).json({ error: 'Email and amount are required' });
        }

        // Convert to smallest currency unit (kobo for NGN, pesewas for GHS)
        const amountInSmallestUnit = Math.round(amount * 100);
        
        const reference = generateReference();

        // Initialize transaction with Paystack
        const response = await fetch('https://api.paystack.co/transaction/initialize', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                email,
                amount: amountInSmallestUnit,
                currency,
                reference,
                callback_url: callback_url || `${process.env.BASE_URL || 'https://www.homeworkpal.online'}/client.html?payment=callback`,
                metadata: {
                    ...metadata,
                    custom_fields: [
                        {
                            display_name: "Order Type",
                            variable_name: "order_type",
                            value: metadata.orderType || "assignment"
                        }
                    ]
                }
            })
        });

        const data = await response.json();

        if (!data.status) {
            console.error('Paystack init error:', data);
            return res.status(400).json({ error: data.message || 'Failed to initialize payment' });
        }

        // Store pending transaction
        await pool.query(`
            INSERT INTO payment_transactions (
                reference, email, amount, currency, status, metadata, created_at
            ) VALUES ($1, $2, $3, $4, 'pending', $5, NOW())
            ON CONFLICT (reference) DO UPDATE SET
                email = $2, amount = $3, status = 'pending'
        `, [reference, email, amount, currency, JSON.stringify(metadata)]);

        res.json({
            success: true,
            authorization_url: data.data.authorization_url,
            access_code: data.data.access_code,
            reference: data.data.reference
        });

    } catch (error) {
        console.error('Payment initialization error:', error);
        res.status(500).json({ error: 'Failed to initialize payment' });
    }
});

// Verify payment transaction
router.get('/verify/:reference', async (req, res) => {
    try {
        const { reference } = req.params;

        // Verify with Paystack
        const response = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
            headers: {
                'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`
            }
        });

        const data = await response.json();

        if (!data.status) {
            return res.status(400).json({ 
                success: false, 
                error: data.message || 'Verification failed' 
            });
        }

        const transaction = data.data;
        const isSuccessful = transaction.status === 'success';

        // Update transaction record
        await pool.query(`
            UPDATE payment_transactions 
            SET status = $1,
                paystack_response = $2,
                verified_at = NOW(),
                gateway_response = $3,
                channel = $4,
                paid_at = $5
            WHERE reference = $6
        `, [
            transaction.status,
            JSON.stringify(transaction),
            transaction.gateway_response,
            transaction.channel,
            transaction.paid_at,
            reference
        ]);

        res.json({
            success: isSuccessful,
            status: transaction.status,
            amount: transaction.amount / 100, // Convert back from kobo
            currency: transaction.currency,
            reference: transaction.reference,
            channel: transaction.channel,
            paid_at: transaction.paid_at,
            metadata: transaction.metadata
        });

    } catch (error) {
        console.error('Payment verification error:', error);
        res.status(500).json({ error: 'Failed to verify payment' });
    }
});

// Paystack webhook handler
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    try {
        // Verify webhook signature
        const hash = crypto
            .createHmac('sha512', PAYSTACK_SECRET_KEY)
            .update(JSON.stringify(req.body))
            .digest('hex');

        if (hash !== req.headers['x-paystack-signature']) {
            return res.status(401).send('Invalid signature');
        }

        const event = req.body;
        console.log('Paystack webhook event:', event.event);

        switch (event.event) {
            case 'charge.success':
                await handleSuccessfulPayment(event.data);
                break;
            case 'charge.failed':
                await handleFailedPayment(event.data);
                break;
            case 'transfer.success':
                // Handle successful transfer (for writer payouts)
                console.log('Transfer successful:', event.data);
                break;
            case 'transfer.failed':
                console.log('Transfer failed:', event.data);
                break;
        }

        res.sendStatus(200);

    } catch (error) {
        console.error('Webhook error:', error);
        res.sendStatus(500);
    }
});

// Handle successful payment
async function handleSuccessfulPayment(data) {
    const reference = data.reference;
    
    try {
        // Update transaction
        await pool.query(`
            UPDATE payment_transactions 
            SET status = 'success',
                paystack_response = $1,
                paid_at = $2,
                verified_at = NOW()
            WHERE reference = $3
        `, [JSON.stringify(data), data.paid_at, reference]);

        // Get transaction metadata
        const txResult = await pool.query(
            'SELECT metadata FROM payment_transactions WHERE reference = $1',
            [reference]
        );

        if (txResult.rows.length > 0) {
            const metadata = txResult.rows[0].metadata;
            
            // If this was for an order, mark it as paid
            if (metadata?.orderNumber) {
                await pool.query(`
                    UPDATE client_orders 
                    SET payment_status = 'paid',
                        payment_method = 'paystack',
                        payment_reference = $1,
                        paid_at = NOW()
                    WHERE order_number = $2
                `, [reference, metadata.orderNumber]);
            }
        }

        console.log(`Payment ${reference} processed successfully`);

    } catch (error) {
        console.error('Error handling successful payment:', error);
    }
}

// Handle failed payment
async function handleFailedPayment(data) {
    const reference = data.reference;
    
    try {
        await pool.query(`
            UPDATE payment_transactions 
            SET status = 'failed',
                paystack_response = $1,
                gateway_response = $2
            WHERE reference = $3
        `, [JSON.stringify(data), data.gateway_response, reference]);

        console.log(`Payment ${reference} failed: ${data.gateway_response}`);

    } catch (error) {
        console.error('Error handling failed payment:', error);
    }
}

// Get public key (for frontend)
router.get('/config', (req, res) => {
    res.json({
        publicKey: PAYSTACK_PUBLIC_KEY,
        currency: process.env.PAYSTACK_CURRENCY || 'NGN'
    });
});

// List banks (for transfers/payouts)
router.get('/banks', async (req, res) => {
    try {
        const country = req.query.country || 'nigeria';
        
        const response = await fetch(`https://api.paystack.co/bank?country=${country}`, {
            headers: {
                'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`
            }
        });

        const data = await response.json();

        if (!data.status) {
            return res.status(400).json({ error: 'Failed to fetch banks' });
        }

        res.json({
            success: true,
            banks: data.data.map(bank => ({
                name: bank.name,
                code: bank.code,
                type: bank.type
            }))
        });

    } catch (error) {
        console.error('Error fetching banks:', error);
        res.status(500).json({ error: 'Failed to fetch banks' });
    }
});

// Verify bank account
router.post('/verify-account', async (req, res) => {
    try {
        const { account_number, bank_code } = req.body;

        const response = await fetch(
            `https://api.paystack.co/bank/resolve?account_number=${account_number}&bank_code=${bank_code}`,
            {
                headers: {
                    'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`
                }
            }
        );

        const data = await response.json();

        if (!data.status) {
            return res.status(400).json({ error: data.message || 'Could not verify account' });
        }

        res.json({
            success: true,
            account_name: data.data.account_name,
            account_number: data.data.account_number
        });

    } catch (error) {
        console.error('Error verifying account:', error);
        res.status(500).json({ error: 'Failed to verify account' });
    }
});

module.exports = router;
