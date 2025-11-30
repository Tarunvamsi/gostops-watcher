// priceWatcher.js
const express = require("express");
const puppeteer = require("puppeteer");
const nodemailer = require("nodemailer");

// ENV
const URL = process.env.URL;
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_PASS = process.env.GMAIL_APP_PASS;
const EMAIL_TO_1 = process.env.EMAIL_TO_1;
const EMAIL_TO_2 = process.env.EMAIL_TO_2;
const CHECK_INTERVAL = process.env.CHECK_INTERVAL ? Number(process.env.CHECK_INTERVAL) : 10 * 60 * 1000;

// thresholds
const thresholds = [3000, 2500, 2000, 1500, 1000];
let currentIndex = 0;
let lastNotifiedPrice = Infinity;

function log(...msg) {
  console.log(`[${new Date().toISOString()}]`, ...msg);
}

// Nodemailer
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: GMAIL_USER,
    pass: GMAIL_PASS
  }
});

async function sendAlertEmail(price, threshold) {
  await transporter.sendMail({
    from: GMAIL_USER,
    to: [EMAIL_TO_1, EMAIL_TO_2],
    subject: `GoStops Price Alert! Price ₹${price} (Threshold ₹${threshold})`,
    text: `📢 GoSTOPS Price Drop Alert!

Great news — the room price at goSTOPS Srinagar just dropped!

🔹 Current Price: ₹${price}
🔹 Trigger Threshold: ₹${threshold}
🔹 Checked At: ${new Date().toLocaleString()}

This email was sent because:
✔ The price is below your active threshold
✔ The price is lower than any previously notified price

🔗 Book now:
${URL}

📌 What happens next?
Your watcher continues running.
Next threshold to monitor: ₹${thresholds[currentIndex + 1] ?? "No more thresholds — final reached"}

You'll receive another alert only if the price drops further.

Happy deal hunting!  
Your GoStops Price Watcher 🤖`
  });

  log(`Email sent for threshold ₹${threshold} → recipients: ${EMAIL_TO_1}, ${EMAIL_TO_2}`);
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let totalHeight = 0;
      const distance = 400;
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= document.body.scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 200);
    });
  });
}

async function checkPriceOnce() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
  });

  try {
    const page = await browser.newPage();
    await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await new Promise(res => setTimeout(res, 3000));
    await autoScroll(page);
    const text = await page.evaluate(() => document.body.innerText);
    log("Extracted text from page.");

    let match = text.match(/Starting from\s*₹\s*([0-9.,]+)/i);
    if (!match) match = text.match(/₹\s*([0-9.,]+)/);

    if (!match) {
      log("No valid price found.");
      return null;
    }

    const price = parseFloat(match[1].replace(/,/g, ""));
    log("Parsed price:", price);
    return price;
  } catch (err) {
    log("Error in checkPriceOnce:", err.message || err);
    return null;
  } finally {
    try { await browser.close(); } catch(e) {}
  }
}

// watcher loop (runs until final threshold reached)
async function runWatcherLoop() {
  log("Watcher loop starting. Thresholds:", thresholds.join(" → "));
  while (currentIndex < thresholds.length) {
    const currentThreshold = thresholds[currentIndex];
    try {
      log(`Checking… target ₹${currentThreshold}, lastNotified: ${lastNotifiedPrice === Infinity ? "none" : "₹"+lastNotifiedPrice}`);
      const price = await checkPriceOnce();

      if (price !== null && !isNaN(price)) {
        if (price <= currentThreshold && price < lastNotifiedPrice) {
          await sendAlertEmail(price, currentThreshold);
          lastNotifiedPrice = price;
          currentIndex++;
          if (currentIndex >= thresholds.length) {
            log("Final threshold reached. Stopping watcher loop.");
            break;
          } else {
            log(`Next threshold -> ₹${thresholds[currentIndex]}`);
          }
        } else if (price <= currentThreshold && price >= lastNotifiedPrice) {
          log(`Price ₹${price} <= threshold but not lower than previous notified ₹${lastNotifiedPrice}. No email.`);
        } else {
          log(`Price ₹${price} is above threshold ₹${currentThreshold}.`);
        }
      }
    } catch (err) {
      log("Unhandled error in loop:", err.message || err);
    }

    log(`Sleeping ${Math.round(CHECK_INTERVAL/60000)} minute(s) before next check.`);
    await new Promise(res => setTimeout(res, CHECK_INTERVAL));
  }
  log("Watcher loop finished.");
}

// Express keep-alive server for Render (and health checks)
const app = express();
app.get("/", (req, res) => res.send("OK"));
const port = process.env.PORT || 3000;
app.listen(port, () => {
  log(`Express keep-alive listening on port ${port}`);
  // start the watcher in background
  runWatcherLoop().catch(err => {
    log("Watcher crashed:", err.message || err);
    process.exit(1);
  });
});
