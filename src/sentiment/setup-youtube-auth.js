let google;
try {
  google = require("googleapis").google;
} catch (e) {
  console.error("Please install googleapis first: npm install googleapis");
  process.exit(1);
}
const readline = require("readline");
require("dotenv").config();

// Run once with `node src/sentiment/setup-youtube-auth.js` to generate a
// refresh token. Paste the resulting value into YOUTUBE_REFRESH_TOKEN in .env.
// Requires YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET already set in .env
// (create these in Google Cloud Console > APIs & Services > Credentials,
// OAuth Client ID, type "Desktop app").

const oauth2Client = new google.auth.OAuth2(
  process.env.YOUTUBE_CLIENT_ID,
  process.env.YOUTUBE_CLIENT_SECRET,
  "urn:ietf:wg:oauth:2.0:oob"
);

const SCOPES = ["https://www.googleapis.com/auth/youtube.readonly"];

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  scope: SCOPES,
  prompt: "consent",
});

console.log("1. Open this URL in your browser and approve access:\n");
console.log(authUrl);
console.log("\n2. Paste the authorization code you receive below.\n");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question("Authorization code: ", async (code) => {
  const { tokens } = await oauth2Client.getToken(code);
  console.log("\nAdd this to your .env file:\n");
  console.log(`YOUTUBE_REFRESH_TOKEN=${tokens.refresh_token}`);
  rl.close();
});
