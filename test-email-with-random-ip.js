#!/usr/bin/env node

/**
 * Test script to send a single email using random IP functionality
 * Usage: node test-email-with-random-ip.js
 * 
 * Make sure to set the following environment variables:
 * - SMTP_HOST: Your SMTP server host
 * - SMTP_PORT: Your SMTP server port (usually 587 or 465)
 * - SMTP_USER: Your SMTP username
 * - SMTP_PASS: Your SMTP password (plain text for this test)
 * - TEST_TO_EMAIL: Email address to send the test email to
 * - TEST_FROM_EMAIL: Email address to send from
 * - TEST_FROM_NAME: Name to send from
 */

import process from 'process';
import { sendSMTPEmail } from './dist/lib/smtp.js';
import { getRandomIP } from './dist/config.js';

async function testEmailWithRandomIP() {
  try {
    // Check required environment variables
    const requiredEnvVars = [
      'SMTP_HOST',
      'SMTP_PORT', 
      'SMTP_USER',
      'SMTP_PASS',
      'TEST_TO_EMAIL',
      'TEST_FROM_EMAIL',
      'TEST_FROM_NAME'
    ];

    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
    if (missingVars.length > 0) {
      console.error('❌ Missing required environment variables:');
      missingVars.forEach(varName => console.error(`   - ${varName}`));
      console.error('\nPlease set these environment variables and try again.');
      process.exit(1);
    }

    console.log('🚀 Starting email test with random IP...\n');

    // Get a random IP for this test
    const selectedIP = getRandomIP();
    console.log(`📍 Selected IP address: ${selectedIP}`);

    // Prepare email data
    const email = {
      senderEmail: process.env.TEST_FROM_EMAIL,
      senderName: process.env.TEST_FROM_NAME,
      recipient: process.env.TEST_TO_EMAIL,
      subject: `Test Email with Random IP - ${new Date().toISOString()}`,
      body: `
        <html>
          <body>
            <h2>🎯 Random IP Test Email</h2>
            <p>This is a test email sent using the random IP functionality.</p>
            <hr>
            <p><strong>Test Details:</strong></p>
            <ul>
              <li><strong>Sent from IP:</strong> ${selectedIP}</li>
              <li><strong>Timestamp:</strong> ${new Date().toISOString()}</li>
              <li><strong>SMTP Host:</strong> ${process.env.SMTP_HOST}</li>
              <li><strong>SMTP Port:</strong> ${process.env.SMTP_PORT}</li>
            </ul>
            <hr>
            <p>If you received this email, the random IP functionality is working correctly! ✅</p>
          </body>
        </html>
      `,
      replyToEmail: process.env.TEST_FROM_EMAIL,
      campaignId: 'test-random-ip-' + Date.now()
    };

    // Import encryptToken to encrypt the password for testing
    const { encryptToken } = await import('./dist/lib/decrypt.js');
    
    // Prepare SMTP credentials (encrypt the password for proper handling)
    const smtpCredentials = {
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT),
      user: process.env.SMTP_USER,
      encryptedPass: encryptToken(process.env.SMTP_PASS) // Encrypt the password
    };

    console.log('📧 Sending test email...');
    console.log(`   From: ${email.senderName} <${email.senderEmail}>`);
    console.log(`   To: ${email.recipient}`);
    console.log(`   Subject: ${email.subject}`);
    console.log(`   Using IP: ${selectedIP}\n`);

    // Send the email using the selected IP
    const result = await sendSMTPEmail(email, smtpCredentials, selectedIP);

    console.log('✅ Email sent successfully!');
    console.log('📊 Result details:');
    console.log(`   Message ID: ${result.messageId}`);
    console.log(`   Response: ${result.response}`);
    console.log(`   Accepted: ${JSON.stringify(result.accepted)}`);
    console.log(`   Rejected: ${JSON.stringify(result.rejected)}`);

    console.log('\n🎉 Test completed successfully!');
    console.log('💡 Check your email inbox to confirm the email was received.');

  } catch (error) {
    console.error('❌ Test failed with error:');
    console.error(error.message);
    console.error('\n🔍 Full error details:');
    console.error(error);
    process.exit(1);
  }
}

// Note: For testing with plain text passwords, you'll need to either:
// 1. Use encrypted passwords with the decryptToken function, or  
// 2. Modify the sendSMTPEmail function to handle plain text passwords

// Run the test
if (import.meta.url === `file://${process.argv[1]}`) {
  testEmailWithRandomIP().catch(console.error);
}

export { testEmailWithRandomIP };
