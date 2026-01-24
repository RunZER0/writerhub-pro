const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const jwt = require('jsonwebtoken');

// Pricing configuration
const PRICING = {
    bronze: {
        basePrice: 8.49,  // Average of 6.99-9.99
        minPrice: 6.99,
        maxPrice: 9.99
    },
    silver: {
        basePrice: 12.49, // Average of 9.99-14.99
        minPrice: 9.99,
        maxPrice: 14.99
    },
    gold: {
        basePrice: 17.99, // Average of 15.99-19.99
        minPrice: 15.99,
        maxPrice: 19.99
    }
};

// Note: Urgency fees removed - covered by tier pricing

// Complexity multipliers
const COMPLEXITY = {
    simple: 0.9,    // 10% less
    standard: 1.0,  // Base price
    complex: 1.15,  // 15% more
    expert: 1.30    // 30% more
};

// Auth middleware
const authenticateMember = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (token) {
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'homework-pal-secret');
            if (decoded.type === 'client_member') {
                req.member = decoded;
            }
        } catch (error) {
            // Token invalid, continue as guest
        }
    }
    next();
};

// Generate order number
function generateOrderNumber() {
    const date = new Date();
    const year = date.getFullYear().toString().slice(-2);
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `HP${year}${month}-${random}`;
}

// Calculate exact price
router.post('/calculate', authenticateMember, async (req, res) => {
    try {
        const {
            packageType,
            pages,
            deadlineHours,
            complexity = 'standard',
            domain
        } = req.body;

        if (!packageType || !pages || !deadlineHours) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const pricing = PRICING[packageType];
        if (!pricing) {
            return res.status(400).json({ error: 'Invalid package type' });
        }

        // Calculate base price (urgency included in tier pricing)
        const complexityMultiplier = COMPLEXITY[complexity] || 1.0;
        const basePerPage = pricing.basePrice * complexityMultiplier;
        const basePrice = basePerPage * pages;

        // Subtotal (no separate urgency fee - covered by tier pricing)
        const subtotal = basePrice;

        // Get member discount if authenticated and verified
        let discountPercent = 0;
        let discountAmount = 0;
        let memberTier = null;

        if (req.member) {
            const memberResult = await pool.query(
                'SELECT discount_percent, membership_tier, is_verified FROM client_members WHERE id = $1',
                [req.member.memberId]
            );
            if (memberResult.rows.length > 0 && memberResult.rows[0].is_verified) {
                discountPercent = parseFloat(memberResult.rows[0].discount_percent) || 0;
                memberTier = memberResult.rows[0].membership_tier;
                discountAmount = subtotal * (discountPercent / 100);
            }
        }

        // Final price
        const finalPrice = subtotal - discountAmount;

        res.json({
            success: true,
            breakdown: {
                packageType,
                packageName: packageType.charAt(0).toUpperCase() + packageType.slice(1),
                pages,
                pricePerPage: basePerPage.toFixed(2),
                basePrice: basePrice.toFixed(2),
                deadlineHours,
                subtotal: subtotal.toFixed(2),
                memberTier,
                discountPercent,
                discountAmount: discountAmount.toFixed(2),
                finalPrice: finalPrice.toFixed(2),
                complexity,
                memberSavingsNote: discountPercent > 0 ? `You're saving ${discountPercent}% with your membership!` : 'Join membership to save up to 20% on every order!'
            }
        });

    } catch (error) {
        console.error('Error calculating price:', error);
        res.status(500).json({ error: 'Failed to calculate price' });
    }
});

// Create order (pre-checkout)
router.post('/create', authenticateMember, async (req, res) => {
    try {
        const {
            packageType,
            pages,
            deadlineHours,
            complexity,
            clientName,
            clientEmail,
            clientPhone,
            title,
            domain,
            description
        } = req.body;

        // Recalculate price to ensure accuracy (urgency included in tier pricing)
        const pricing = PRICING[packageType];
        const complexityMultiplier = COMPLEXITY[complexity] || 1.0;
        const basePerPage = pricing.basePrice * complexityMultiplier;
        const basePrice = basePerPage * pages;

        // No separate urgency fee - covered by tier pricing
        const subtotal = basePrice;

        let discountPercent = 0;
        let discountAmount = 0;
        let memberId = null;

        if (req.member) {
            const memberResult = await pool.query(
                'SELECT id, discount_percent, is_verified FROM client_members WHERE id = $1',
                [req.member.memberId]
            );
            if (memberResult.rows.length > 0 && memberResult.rows[0].is_verified) {
                discountPercent = parseFloat(memberResult.rows[0].discount_percent) || 0;
                discountAmount = subtotal * (discountPercent / 100);
                memberId = memberResult.rows[0].id;
            }
        }

        const finalPrice = subtotal - discountAmount;
        const orderNumber = generateOrderNumber();

        // Create order record
        const result = await pool.query(`
            INSERT INTO client_orders (
                order_number, member_id, guest_email, guest_name,
                package_type, base_price, discount_percent, discount_amount,
                final_price, pages, deadline_hours,
                payment_status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending')
            RETURNING *
        `, [
            orderNumber,
            memberId,
            req.member ? null : clientEmail,
            req.member ? null : clientName,
            packageType,
            subtotal,
            discountPercent,
            discountAmount,
            finalPrice,
            pages,
            deadlineHours
        ]);

        res.json({
            success: true,
            order: {
                orderNumber: result.rows[0].order_number,
                finalPrice: parseFloat(result.rows[0].final_price).toFixed(2),
                breakdown: {
                    packageType,
                    pages,
                    basePrice: subtotal.toFixed(2),
                    discountPercent,
                    discountAmount: discountAmount.toFixed(2),
                    finalPrice: finalPrice.toFixed(2)
                }
            }
        });

    } catch (error) {
        console.error('Error creating order:', error);
        res.status(500).json({ error: 'Failed to create order' });
    }
});

// Generate receipt HTML
function generateReceiptHTML(order, isThankYou = false) {
    const date = new Date(order.created_at);
    const formattedDate = date.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>${isThankYou ? 'Thank You - ' : ''}Receipt #${order.order_number}</title>
    <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
        .receipt { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
        .header { background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; padding: 30px; text-align: center; }
        .logo { font-size: 28px; font-weight: bold; margin-bottom: 5px; }
        .logo span { color: #fbbf24; }
        .tagline { opacity: 0.9; font-size: 14px; }
        .thank-you { font-size: 24px; margin: 20px 0 10px; }
        .content { padding: 30px; }
        .order-info { background: #f8fafc; border-radius: 8px; padding: 20px; margin-bottom: 25px; }
        .order-info h3 { margin: 0 0 15px; color: #334155; font-size: 16px; }
        .info-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e2e8f0; }
        .info-row:last-child { border-bottom: none; }
        .info-label { color: #64748b; }
        .info-value { font-weight: 600; color: #1e293b; }
        .breakdown { margin-bottom: 25px; }
        .breakdown h3 { margin: 0 0 15px; color: #334155; font-size: 16px; }
        .breakdown-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #f1f5f9; }
        .breakdown-row.discount { color: #10b981; }
        .breakdown-row.total { border-top: 2px solid #e2e8f0; border-bottom: none; margin-top: 10px; padding-top: 15px; font-size: 18px; font-weight: bold; }
        .breakdown-row.total .amount { color: #6366f1; }
        .status { text-align: center; padding: 20px; background: ${order.payment_status === 'paid' ? '#dcfce7' : '#fef9c3'}; border-radius: 8px; margin-bottom: 25px; }
        .status-badge { display: inline-block; padding: 8px 20px; border-radius: 20px; font-weight: 600; background: ${order.payment_status === 'paid' ? '#22c55e' : '#eab308'}; color: white; }
        .footer { text-align: center; padding: 20px 30px 30px; border-top: 1px solid #e2e8f0; color: #64748b; font-size: 13px; }
        .footer a { color: #6366f1; text-decoration: none; }
        .support { margin-top: 15px; padding: 15px; background: #f8fafc; border-radius: 8px; }
    </style>
</head>
<body>
    <div class="receipt">
        <div class="header">
            <div class="logo">Homework<span>Pal</span></div>
            <div class="tagline">Your Academic Success Partner</div>
            ${isThankYou ? '<div class="thank-you">🎉 Thank You for Your Order!</div>' : ''}
        </div>
        
        <div class="content">
            <div class="order-info">
                <h3>📋 Order Details</h3>
                <div class="info-row">
                    <span class="info-label">Order Number</span>
                    <span class="info-value">${order.order_number}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Date</span>
                    <span class="info-value">${formattedDate}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Package</span>
                    <span class="info-value">${order.package_type.charAt(0).toUpperCase() + order.package_type.slice(1)}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Pages</span>
                    <span class="info-value">${order.pages} pages (~${order.pages * 275} words)</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Deadline</span>
                    <span class="info-value">${order.deadline_hours} hours</span>
                </div>
            </div>

            <div class="breakdown">
                <h3>💰 Price Breakdown</h3>
                <div class="breakdown-row">
                    <span>Base Price (${order.pages} pages)</span>
                    <span>$${parseFloat(order.base_price).toFixed(2)}</span>
                </div>
                ${parseFloat(order.discount_amount) > 0 ? `
                <div class="breakdown-row discount">
                    <span>Member Discount (${order.discount_percent}%)</span>
                    <span>-$${parseFloat(order.discount_amount).toFixed(2)}</span>
                </div>
                <div class="breakdown-row" style="color: #94a3b8; font-size: 12px;">
                    <span>💡 Members save up to 20% on every order!</span>
                    <span></span>
                </div>
                ` : `
                <div class="breakdown-row" style="color: #94a3b8; font-size: 12px;">
                    <span>💡 Join membership to save up to 20% on every order!</span>
                    <span></span>
                </div>
                `}
                <div class="breakdown-row total">
                    <span>Total</span>
                    <span class="amount">$${parseFloat(order.final_price).toFixed(2)}</span>
                </div>
            </div>

            <div class="status">
                <div class="status-badge">${order.payment_status === 'paid' ? '✓ PAID' : '⏳ PENDING PAYMENT'}</div>
            </div>

            <div class="support">
                <strong>Need Help?</strong><br>
                Email: support@homeworkpal.online<br>
                WhatsApp: <a href="https://wa.me/+19514487786">+1 951 448 7786</a>
            </div>
        </div>

        <div class="footer">
            <p>This receipt was generated automatically by HomeworkPal.</p>
            <p><a href="https://www.homeworkpal.online">www.homeworkpal.online</a></p>
        </div>
    </div>
</body>
</html>
    `;
}

// Get receipt
router.get('/:orderNumber/receipt', async (req, res) => {
    try {
        const { orderNumber } = req.params;

        const result = await pool.query(
            'SELECT * FROM client_orders WHERE order_number = $1',
            [orderNumber]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Order not found' });
        }

        const html = generateReceiptHTML(result.rows[0], false);
        res.send(html);

    } catch (error) {
        console.error('Error generating receipt:', error);
        res.status(500).json({ error: 'Failed to generate receipt' });
    }
});

// Mark as paid and send thank you receipt
router.post('/:orderNumber/paid', async (req, res) => {
    try {
        const { orderNumber } = req.params;
        const { paymentMethod, paymentReference } = req.body;

        // Update order status
        const result = await pool.query(`
            UPDATE client_orders 
            SET payment_status = 'paid', 
                payment_method = $1, 
                payment_reference = $2, 
                paid_at = NOW()
            WHERE order_number = $3
            RETURNING *
        `, [paymentMethod, paymentReference, orderNumber]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Order not found' });
        }

        const order = result.rows[0];

        // Get email to send receipt
        let email = order.guest_email;
        if (order.member_id) {
            const member = await pool.query(
                'SELECT email FROM client_members WHERE id = $1',
                [order.member_id]
            );
            if (member.rows.length > 0) {
                email = member.rows[0].email;
            }
        }

        // Send thank you receipt via Brevo
        if (email) {
            await sendThankYouReceipt(order, email);
        }

        // Auto-verify member if they have an order
        if (order.member_id) {
            await pool.query(`
                UPDATE client_members 
                SET is_verified = TRUE, 
                    total_orders = total_orders + 1,
                    total_spent = total_spent + $1
                WHERE id = $2
            `, [order.final_price, order.member_id]);
        }

        res.json({ success: true, message: 'Payment recorded and receipt sent' });

    } catch (error) {
        console.error('Error processing payment:', error);
        res.status(500).json({ error: 'Failed to process payment' });
    }
});

// Send thank you receipt via Brevo email
async function sendThankYouReceipt(order, email) {
    try {
        const brevoApiKey = process.env.BREVO_API_KEY;
        if (!brevoApiKey) {
            console.error('Brevo API key not configured');
            return;
        }

        const receiptHTML = generateReceiptHTML(order, true);

        const response = await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
                'accept': 'application/json',
                'api-key': brevoApiKey,
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                sender: {
                    name: 'HomeworkPal',
                    email: process.env.SENDER_EMAIL || 'admin@homeworkpal.online'
                },
                to: [{ email }],
                subject: `🎉 Thank You! Receipt for Order #${order.order_number}`,
                htmlContent: receiptHTML
            })
        });

        if (response.ok) {
            await pool.query(
                'UPDATE client_orders SET receipt_sent = TRUE, receipt_sent_at = NOW() WHERE id = $1',
                [order.id]
            );
            console.log('Receipt sent successfully to', email);
        } else {
            const error = await response.json();
            console.error('Failed to send receipt:', error);
        }
    } catch (error) {
        console.error('Error sending receipt:', error);
    }
}

module.exports = router;
