const nodemailer = require('nodemailer');

// 1. Setup the transporter using your PrivateEmail credentials
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: true, // true for port 465
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// 2. Define the send function
const sendFriendMessageNotification = async (toEmail, senderName, messageText) => {
  try {
    const info = await transporter.sendMail({
      from: `"BlahBluh" <${process.env.EMAIL_USER}>`, // Sender address
      to: toEmail, // Recipient address
      subject: `New message from ${senderName}`,
      text: `${senderName} says: "${messageText}"`, // Plain text body
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; background-color: #f4f4f4;">
          <div style="max-width: 600px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px;">
            <h2 style="color: #333;">New Message</h2>
            <p style="font-size: 16px;"><strong>${senderName}</strong> sent you a message:</p>
            <blockquote style="background: #eee; padding: 15px; border-left: 4px solid #6c5ce7;">
              "${messageText}"
            </blockquote>
            <p style="color: #888; font-size: 12px; margin-top: 20px;">
              Log in to BlahBluh to reply.
            </p>
          </div>
        </div>
      `, 
    });

    console.log(`[EmailService] Notification sent to ${toEmail}. Message ID: ${info.messageId}`);
    return true;
  } catch (error) {
    console.error('[EmailService] Failed to send email:', error);
    return false;
  }
};

module.exports = { sendFriendMessageNotification };