const nodemailer = require('nodemailer');

// Create transporter
const createTransporter = () => {
    return nodemailer.createTransport({
        host: process.env.EMAIL_HOST || 'smtp.gmail.com',
        port: process.env.EMAIL_PORT || 587,
        secure: false,
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
    });
};

// Send email
const sendEmail = async (to, subject, html) => {
    try {
        if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
            console.log('📧 Email not configured, skipping notification');
            return false;
        }

        const transporter = createTransporter();
        
        const mailOptions = {
            from: `"HomeworkHub" <${process.env.EMAIL_USER}>`,
            to,
            subject,
            html
        };

        await transporter.sendMail(mailOptions);
        console.log(`📧 Email sent to ${to}`);
        return true;
    } catch (error) {
        console.error('Email error:', error.message);
        return false;
    }
};

// Email templates
const emailTemplates = {
    newAssignment: (writerName, assignment) => ({
        subject: `New Assignment: ${assignment.title}`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 30px; text-align: center;">
                    <h1 style="color: white; margin: 0;">📚 HomeworkHub</h1>
                </div>
                <div style="padding: 30px; background: #f8fafc;">
                    <h2 style="color: #1e293b;">Hello ${writerName}!</h2>
                    <p style="color: #64748b; font-size: 16px;">You have been assigned a new writing task:</p>
                    
                    <div style="background: white; border-radius: 12px; padding: 24px; margin: 20px 0; border: 1px solid #e2e8f0;">
                        <h3 style="color: #1e293b; margin-top: 0;">${assignment.title}</h3>
                        <table style="width: 100%; border-collapse: collapse;">
                            <tr>
                                <td style="padding: 8px 0; color: #64748b;">Word Count:</td>
                                <td style="padding: 8px 0; color: #1e293b; font-weight: bold;">${assignment.word_count.toLocaleString()} words</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 0; color: #64748b;">Deadline:</td>
                                <td style="padding: 8px 0; color: #1e293b; font-weight: bold;">${new Date(assignment.deadline).toLocaleDateString()}</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 0; color: #64748b;">Payment:</td>
                                <td style="padding: 8px 0; color: #10b981; font-weight: bold;">$${assignment.amount.toFixed(2)}</td>
                            </tr>
                        </table>
                        ${assignment.description ? `<p style="color: #64748b; margin-top: 16px; padding-top: 16px; border-top: 1px solid #e2e8f0;">${assignment.description}</p>` : ''}
                    </div>
                    
                    <a href="${process.env.APP_URL || 'http://localhost:3000'}" 
                       style="display: inline-block; background: #6366f1; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold;">
                        View Assignment
                    </a>
                </div>
                <div style="padding: 20px; text-align: center; color: #94a3b8; font-size: 14px;">
                    <p>HomeworkHub - Assignment Management System</p>
                </div>
            </div>
        `
    }),

    paymentReceived: (writerName, payment) => ({
        subject: `Payment Received: $${payment.amount.toFixed(2)}`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background: linear-gradient(135deg, #10b981, #059669); padding: 30px; text-align: center;">
                    <h1 style="color: white; margin: 0;">💰 Payment Notification</h1>
                </div>
                <div style="padding: 30px; background: #f8fafc;">
                    <h2 style="color: #1e293b;">Hello ${writerName}!</h2>
                    <p style="color: #64748b; font-size: 16px;">Great news! A payment has been processed for you:</p>
                    
                    <div style="background: white; border-radius: 12px; padding: 24px; margin: 20px 0; border: 1px solid #e2e8f0; text-align: center;">
                        <p style="color: #64748b; margin: 0;">Amount Paid</p>
                        <h2 style="color: #10b981; font-size: 36px; margin: 10px 0;">$${payment.amount.toFixed(2)}</h2>
                        <p style="color: #64748b; margin: 0;">via ${payment.method.replace('-', ' ')}</p>
                        ${payment.reference ? `<p style="color: #94a3b8; font-size: 14px; margin-top: 10px;">Ref: ${payment.reference}</p>` : ''}
                    </div>
                    
                    <a href="${process.env.APP_URL || 'http://localhost:3000'}" 
                       style="display: inline-block; background: #10b981; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold;">
                        View Dashboard
                    </a>
                </div>
                <div style="padding: 20px; text-align: center; color: #94a3b8; font-size: 14px;">
                    <p>HomeworkHub - Assignment Management System</p>
                </div>
            </div>
        `
    }),

    welcomeWriter: (writerName, email, tempPassword) => ({
        subject: 'Welcome to HomeworkHub!',
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 30px; text-align: center;">
                    <h1 style="color: white; margin: 0;">📚 Welcome to HomeworkHub!</h1>
                </div>
                <div style="padding: 30px; background: #f8fafc;">
                    <h2 style="color: #1e293b;">Hello ${writerName}!</h2>
                    <p style="color: #64748b; font-size: 16px;">Your writer account has been created. Here are your login credentials:</p>
                    
                    <div style="background: white; border-radius: 12px; padding: 24px; margin: 20px 0; border: 1px solid #e2e8f0;">
                        <table style="width: 100%; border-collapse: collapse;">
                            <tr>
                                <td style="padding: 8px 0; color: #64748b;">Email:</td>
                                <td style="padding: 8px 0; color: #1e293b; font-weight: bold;">${email}</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 0; color: #64748b;">Temporary Password:</td>
                                <td style="padding: 8px 0; color: #6366f1; font-weight: bold; font-family: monospace;">${tempPassword}</td>
                            </tr>
                        </table>
                    </div>
                    
                    <p style="color: #ef4444; font-size: 14px;">⚠️ Please change your password after your first login!</p>
                    
                    <a href="${process.env.APP_URL || 'http://localhost:3000'}" 
                       style="display: inline-block; background: #6366f1; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold;">
                        Login Now
                    </a>
                </div>
                <div style="padding: 20px; text-align: center; color: #94a3b8; font-size: 14px;">
                    <p>HomeworkHub - Assignment Management System</p>
                </div>
            </div>
        `
    })
};

module.exports = { sendEmail, emailTemplates };
