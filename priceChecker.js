const puppeteer = require("puppeteer");
const nodemailer = require("nodemailer");

// ENV VARIABLES (from Render)
const URL = process.env.URL;

const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_PASS = process.env.GMAIL_APP_PASS;

const EMAIL_TO_1 = process.env.EMAIL_TO_1;
const EMAIL_TO_2 = process.env.EMAIL_TO_2;

// Stepped thresholds
const thresholds = [3000, 2500, 2000, 1500, 1000];
let currentIndex = 0;

// Interval from ENV or fallback to 10 min
const CHECK_INTERVAL = process.env.CHECK_INTERVAL
  ? Number(process.env.CHECK_INTERVAL)
  : 10 * 60 * 1000;

// Logger
function log(...msg) {
  console.log(`[${new Date().toISOString()}]`, ...msg);
}

// Nodemailer transporter (using env vars)
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
Next threshold to monitor: ₹${
      thresholds[currentIndex + 1] ?? "No more thresholds — final reached"
    }

You'll receive another alert only if the price drops further.

Happy deal hunting!  
Your GoStops Price Watcher 🤖`
  });

  log(`Email sent for threshold ₹${threshold} → recipients: ${EMAIL_TO_1}, ${EMAIL_TO_2}`);
}

async function checkPrice() {
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage"
    ]
  });

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
    await browser.close();
    return null;
  }

  const price = parseFloat(match[1].replace(/,/g, ""));
  log("Parsed price:", price);

  await browser.close();
  return price;
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

let lastNotifiedPrice = Infinity;

(async function runWatcher() {
  log("Watcher started...");
  log("Threshold sequence:", thresholds.join(" → "));

  while (currentIndex < thresholds.length) {
    const currentThreshold = thresholds[currentIndex];

    try {
      log(
        `Checking… threshold: ₹${currentThreshold}, last notified: ${
          lastNotifiedPrice === Infinity ? "none" : "₹" + lastNotifiedPrice
        }`
      );

      const price = await checkPrice();

      if (price !== null && !isNaN(price)) {
        if (price <= currentThreshold && price < lastNotifiedPrice) {
          await sendAlertEmail(price, currentThreshold);

          lastNotifiedPrice = price;
          currentIndex++;

          if (currentIndex >= thresholds.length) {
            log("Final threshold reached. Exiting watcher.");
            process.exit(0);
          } else {
            log(`Next threshold → ₹${thresholds[currentIndex]}`);
          }

        } else if (price <= currentThreshold && price >= lastNotifiedPrice) {
          log(`Price ₹${price} <= threshold BUT not lower than last notified. No email.`);
        } else {
          log(`Price ₹${price} is above threshold ₹${currentThreshold}.`);
        }
      }

    } catch (err) {
      log("Error during check:", err.message);
    }

    log(`Sleeping ${CHECK_INTERVAL / 60000} minutes before next check.\n`);
    await new Promise(res => setTimeout(res, CHECK_INTERVAL));
  }

  log("Watcher completed all thresholds. Stopped.");
  process.exit(0);
})();
