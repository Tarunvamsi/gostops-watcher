const express = require("express");
const puppeteer = require("puppeteer");
const nodemailer = require("nodemailer");

// ENV
const URL = process.env.URL;
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_PASS = process.env.GMAIL_APP_PASS;
const EMAIL_TO_1 = process.env.EMAIL_TO_1;
const EMAIL_TO_2 = process.env.EMAIL_TO_2;
const CHECK_INTERVAL = process.env.CHECK_INTERVAL ? Number(process.env.CHECK_INTERVAL) : 600000;

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
Next threshold to monitor: ₹${thresholds[currentIndex + 1] ?? "Final threshold reached"}

You'll receive another alert if price drops again.

Happy deal hunting!  
Your GoStops Price Watcher 🤖`
  });

  log(`Email sent for threshold ₹${threshold} → ${EMAIL_TO_1}, ${EMAIL_TO_2}`);
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let totalHeight = 0;
      const distance = 300;
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= document.body.scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 150);
    });
  });
}

async function checkPriceOnce() {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: puppeteer.executablePath(),  // IMPORTANT FIX!
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-software-rasterizer"
    ]
  });

  try {
    const page = await browser.newPage();
    await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });

    await new Promise(res => setTimeout(res, 3000));
    await autoScroll(page);

    const text = await page.evaluate(() => document.body.innerText);
    log("Extracted text.");

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
    log("Error in checkPriceOnce:", err.message);
    return null;

  } finally {
    try { await browser.close(); } catch {}
  }
}

async function runWatcherLoop() {
  log("Watcher loop starting → thresholds:", thresholds.join(" → "));

  while (currentIndex < thresholds.length) {
    const threshold = thresholds[currentIndex];
    log(`Checking… Target ₹${threshold}, Last Notified: ${
      lastNotifiedPrice === Infinity ? "none" : "₹" + lastNotifiedPrice
    }`);

    try {
      const price = await checkPriceOnce();

      if (price !== null && !isNaN(price)) {
        if (price <= threshold && price < lastNotifiedPrice) {
          await sendAlertEmail(price, threshold);
          lastNotifiedPrice = price;
          currentIndex++;

          if (currentIndex >= thresholds.length) {
            log("Final threshold reached — stopping.");
            break;
          } else {
            log(`Next threshold → ₹${thresholds[currentIndex]}`);
          }

        } else if (price <= threshold && price >= lastNotifiedPrice) {
          log(`Price ₹${price} <= threshold but NOT lower than last notified (₹${lastNotifiedPrice})`);
        } else {
          log(`Price ₹${price} is above current threshold.`);
        }
      }

    } catch (e) {
      log("Error inside loop:", e.message);
    }

    log(`Sleeping ${CHECK_INTERVAL / 60000} minutes...\n`);
    await new Promise(res => setTimeout(res, CHECK_INTERVAL));
  }

  log("Watcher finished all thresholds.");
}

// Express — required for Render free plan
const app = express();
app.get("/", (req, res) => res.send("OK"));

const port = process.env.PORT || 3000;
app.listen(port, () => {
  log(`Keep-alive server running on ${port}`);
  runWatcherLoop().catch(err => {
    log("Watcher crashed:", err.message);
    process.exit(1);
  });
});
