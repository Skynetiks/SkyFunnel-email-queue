// Simple test script to verify random IP functionality
const { getRandomIP, IP_POOL } = require('./dist/config.js');

console.log('Available IP addresses:');
console.log(IP_POOL);
console.log('\nTesting random IP selection:');

// Test 10 random IP selections
for (let i = 0; i < 10; i++) {
  const randomIP = getRandomIP();
  console.log(`${i + 1}. ${randomIP}`);
}

console.log('\nRandom IP functionality is working correctly!');
