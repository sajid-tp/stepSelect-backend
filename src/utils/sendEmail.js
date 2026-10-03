const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',              // or use host/port for other providers
  auth: {
    user: process.env.EMAIL_USER,   // your sending email address
    pass: process.env.EMAIL_PASS,   // app password, NOT your normal password
  },
});

const sendEmail = async ({ to, subject, html }) => {
  await transporter.sendMail({
    from: `"stepSelect" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    html,
  });
};

module.exports = sendEmail;