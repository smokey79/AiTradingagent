const axios = require('axios');
require('dotenv').config();

async function testGemini() {
  const apiKey = process.env.GEMINI_API_KEY;
  console.log('Testing Gemini API with key:', apiKey);
  try {
    const res = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        contents: [{ parts: [{ text: "Hello" }] }]
      },
      {
        headers: { 'Content-Type': 'application/json' }
      }
    );
    console.log('Success!', res.data);
  } catch (err) {
    console.error('Error Status:', err.response?.status);
    console.error('Error Data:', JSON.stringify(err.response?.data, null, 2));
  }
}

testGemini();
