const express = require("express");
const puppeteer = require("puppeteer-core");
const chromium = require("@sparticuz/chromium");
const nodemailer = require("nodemailer");

// ENV
const URL = process.env.URL;
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_PASS = process.env.GMAIL_APP_PASS;
const EMAIL_TO_1 = process.env.EMAIL_TO_1;
const EMAIL_TO_2 = process.env.EMAIL_TO_2;
const CHECK_INTERVAL = process.env.CHECK_INTERVAL
  ? Number(process.env.CHECK_INTERVAL)
  : 600000;

// thresholds
const thresholds = [3000, 2500, 2000, 1500, 1000];
let currentIndex = 0;
let lastNotifiedPrice = Infinity;

function log(...msg) {
  console.log(`[${new Date().toISOString()}]`, ...msg);
}

// Email transporter
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

Book now:
${URL}

Next threshold: ₹${thresholds[currentIndex + 1] ?? "No more"}`
  });

  log(`Email sent for threshold ₹${threshold}`);
}

// Scroll helper
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let totalHeight = 0;
      const dist = 300;
      const timer = setInterval(() => {
        window.scrollBy(0, dist);
        totalHeight += dist;
        if (totalHeight >= document.body.scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 120);
    });
  });
}

// Check price
async function checkPriceOnce() {
  let browser;

  try {
    const execPath = await chromium.executablePath();

    log("Launching Chromium from:", execPath);

    browser = await puppeteer.launch({
      executablePath: execPath,
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      headless: chromium.headless
    });

    const page = await browser.newPage();
    await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await new Promise(res => setTimeout(res, 2000));
    await autoScroll(page);

    const text = await page.evaluate(() => document.body.innerText);
    let match = text.match(/Starting from\s*₹\s*([0-9.,]+)/i);
    if (!match) match = text.match(/₹\s*([0-9.,]+)/);

    if (!match) {
      log("Price not found.");
      return null;
    }

    const price = parseFloat(match[1].replace(/,/g, ""));
    log("Parsed price:", price);
    return price;

  } catch (err) {
    log("Scraping error:", err.message);
    return null;

  } finally {
    try { if (browser) await browser.close(); } catch {}
  }
}

// Watch loop
async function runWatcherLoop() {
  log("Watcher started → thresholds:", thresholds.join(" → "));

  while (currentIndex < thresholds.length) {
    const threshold = thresholds[currentIndex];

    log(`Checking… current threshold ₹${threshold}, last notified: ${
      lastNotifiedPrice === Infinity ? "none" : lastNotifiedPrice
    }`);

    const price = await checkPriceOnce();

    if (price !== null && price <= threshold && price < lastNotifiedPrice) {
      await sendAlertEmail(price, threshold);
      lastNotifiedPrice = price;
      currentIndex++;
    }

    log(`Sleeping ${CHECK_INTERVAL / 60000} minutes...\n`);
    await new Promise(r => setTimeout(r, CHECK_INTERVAL));
  }

  log("All thresholds completed.");
}

// Express keep-alive
const app = express();
app.get("/", (req, res) => res.send("OK"));

const port = process.env.PORT || 3000;
app.listen(port, () => {
  log(`Server running on ${port}`);
  runWatcherLoop();
});
