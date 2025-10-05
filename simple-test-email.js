#!/usr/bin/env node

/**
 * Simple test script to send one email using random IP
 * 
 * Set these environment variables before running:
 * export SMTP_HOST="your-smtp-host.com"
 * export SMTP_PORT="587"
 * export SMTP_USER="your-username"
 * export SMTP_PASS="your-password"
 * export TEST_TO_EMAIL="recipient@example.com"
 * export TEST_FROM_EMAIL="sender@yourdomain.com"
 * export TEST_FROM_NAME="Test Sender"
 * 
 * Then run: node simple-test-email.js
 */

import process from 'process';
import nodemailer from 'nodemailer';
import { getRandomIP, IP_POOL } from './dist/config.js';

async function sendTestEmail() {
  console.log('🌐 Available IP addresses:', IP_POOL);
  
  const randomIP = getRandomIP();
  console.log(`📍 Selected random IP: ${randomIP}`);

  // Create transporter with random IP
  const transporter = nodemailer.createTransporter({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_PORT === '465',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    },
    localAddress: randomIP, // This binds to the specific IP
    debug: true,
    logger: true
  });

  const mailOptions = {
    from: `${process.env.TEST_FROM_NAME} <${process.env.TEST_FROM_EMAIL}>`,
    to: process.env.TEST_TO_EMAIL,
    subject: `Test Email from IP ${randomIP} - ${new Date().toLocaleString()}`,
    html: `
      <h2>🎯 Random IP Test Email</h2>
      <p>This email was sent using IP address: <strong>${randomIP}</strong></p>
      <p>Timestamp: ${new Date().toISOString()}</p>
      <p>SMTP Host: ${process.env.SMTP_HOST}</p>
      <p>SMTP Port: ${process.env.SMTP_PORT}</p>
      <hr>
      <p>If you received this email, the random IP functionality is working! ✅</p>
    `,
    text: `
      Random IP Test Email
      
      This email was sent using IP address: ${randomIP}
      Timestamp: ${new Date().toISOString()}
      SMTP Host: ${process.env.SMTP_HOST}
      SMTP Port: ${process.env.SMTP_PORT}
      
      If you received this email, the random IP functionality is working!
    `
  };

  try {
    console.log('📧 Sending email...');
    const info = await transporter.sendMail(mailOptions);
    
    console.log('✅ Email sent successfully!');
    console.log('Message ID:', info.messageId);
    console.log('Response:', info.response);
    console.log('Accepted:', info.accepted);
    console.log('Rejected:', info.rejected);
    
    await transporter.close();
    console.log('🎉 Test completed!');
    
  } catch (error) {
    console.error('❌ Failed to send email:', error.message);
    console.error('Full error:', error);
    await transporter.close();
    process.exit(1);
  }
}

// Check required environment variables
const required = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'TEST_TO_EMAIL', 'TEST_FROM_EMAIL', 'TEST_FROM_NAME'];
const missing = required.filter(env => !process.env[env]);

if (missing.length > 0) {
  console.error('❌ Missing required environment variables:');
  missing.forEach(env => console.error(`   ${env}`));
  console.error('\nExample usage:');
  console.error('export SMTP_HOST="smtp.gmail.com"');
  console.error('export SMTP_PORT="587"');
  console.error('export SMTP_USER="your-email@gmail.com"');
  console.error('export SMTP_PASS="your-app-password"');
  console.error('export TEST_TO_EMAIL="recipient@example.com"');
  console.error('export TEST_FROM_EMAIL="sender@yourdomain.com"');
  console.error('export TEST_FROM_NAME="Test Sender"');
  console.error('node simple-test-email.js');
  process.exit(1);
}

sendTestEmail();
