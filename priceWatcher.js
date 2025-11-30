const puppeteer = require("puppeteer");
const nodemailer = require("nodemailer");

const URL = "https://gostops.com/stay/Srinagar/srinagar-hostel?checkin=2026-01-16&checkout=2026-01-17";

// Stepped thresholds
const thresholds = [2500, 2000, 1500, 1000];
let currentIndex = 0;

const CHECK_INTERVAL = 10 * 60 * 1000; // 10 minutes

// Timestamp helper
function log(...msg) {
  const now = new Date();

  const timestamp = now.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

  console.log(`[${timestamp}]`, ...msg);
}


// Email setup (your variables)
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "tarunvamsipusarla@gmail.com",
    pass: "uskguyltgjebtqeg"
  }
});

async function sendAlertEmail(price, threshold) {
  const nextThreshold =
    thresholds[currentIndex + 1] !== undefined
      ? `₹${thresholds[currentIndex + 1]}`
      : "No more thresholds — final one 🎉";

  function buildMessage(name) {
    return `Alert ${name},

Great news — the price at **goSTOPS Srinagar** just dropped!


 🏷️ Current Price: ₹${price.toLocaleString()}           
 🎯 Trigger Threshold: ₹${threshold.toLocaleString()}    
 🕒 Checked At: ${new Date().toLocaleString()}  

Why this alert was triggered:
✔ Price fell below your active threshold  
✔ It is lower than any previously notified price  

🔗 **Book your stay:**  
${URL}

📌 **What happens next?**
Your watcher stays active.

👉 **Next threshold:** ${nextThreshold}

You’ll get another alert only if the price drops further.

Happy deal hunting,  
**Your GoSTOPS Price Watcher 🤖**
`;
  }

  const subject = `Gostops Price Drop — Now ₹${price} (Trigger: ₹${threshold})`;
  const headers = {
    "X-Priority": "1",
    "X-MSMail-Priority": "High",
    "Priority": "urgent",
    "Importance": "High"
  };

  // Send to Tarun
  await transporter.sendMail({
    from: "tarunvamsipusarla@gmail.com",
    to: "pusarlatarunvamsi@gmail.com",
    subject,
    text: buildMessage("Tarun"),
    headers
  });

  // Send to Sai
  await transporter.sendMail({
    from: "tarunvamsipusarla@gmail.com",
    to: "psai7094@gmail.com",
    subject,
    text: buildMessage("Sai"),
    headers
  });

  log(`Emails sent to Tarun & Sai for threshold ₹${threshold}`);
}



async function checkPrice() {
  log("Launching browser...");

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage"
    ]
  });

  log("Browser launched. Opening page...");

  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });

  log("Page loaded. Waiting for content...");
  await new Promise(res => setTimeout(res, 3000));

  await autoScroll(page);
  log("Page fully scrolled. Extracting price...");

  const text = await page.evaluate(() => document.body.innerText);

  let match = text.match(/Starting from\s*₹\s*([0-9.,]+)/i);
  if (!match) match = text.match(/₹\s*([0-9.,]+)/);

  if (!match) {
    log("⚠️ Unable to extract price. The site structure may have changed.");
    await browser.close();
    return null;
  }

  const price = parseFloat(match[1].replace(/,/g, ""));
  log(`📌 Price found: ₹${price}`);

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

// TRACK last notified price to prevent spam
let lastNotifiedPrice = Infinity;

// MAIN WATCHER LOOP
// MAIN WATCHER LOOP
(async function runWatcher() {
  log("Watcher started...");
  log("Threshold path:", thresholds.join(" → "));

  while (currentIndex < thresholds.length) {
    const currentThreshold = thresholds[currentIndex];

    log("--------------------------------------------------------------");
    log(`🕒 Checking price at: ${new Date().toLocaleString()}`);
    log(`🎯 Current threshold: ₹${currentThreshold}`);
    log(`📉 Last notified price: ${lastNotifiedPrice === Infinity ? "none yet" : "₹" + lastNotifiedPrice}`);
    log("--------------------------------------------------------------");

    let price = null;
    let retryCount = 0;

    // ------------------------------
    // RETRY LOGIC (max 3 times)
    // ------------------------------
    while (retryCount < 3) {
      price = await checkPrice();

      if (price !== null) break;

      retryCount++;
      log(`⚠️ Retry ${retryCount}/3 in 1 minute... (couldn't extract price)`);

      await new Promise(res => setTimeout(res, 60 * 1000)); // 1 MINUTE
    }

    // If still null after retries → skip whole cycle
    if (price === null) {
      log("❌ Failed to extract price after 3 retries. Sleeping 10 minutes...");
      log("--------------------------------------------------------------\n");
      await new Promise(res => setTimeout(res, CHECK_INTERVAL));
      continue;
    }

    // ------------------------------
    // PRICE CHECKING LOGIC (same)
    // ------------------------------
    log(`💰 Current price: ₹${price}`);

    if (price <= currentThreshold && price < lastNotifiedPrice) {
      log("🎉 Price dropped! Sending alert email...");

      await sendAlertEmail(price, currentThreshold);

      lastNotifiedPrice = price;
      currentIndex++;

      if (currentIndex >= thresholds.length) {
        log("🚀 All thresholds completed. Stopping watcher.");
        process.exit(0);
      }

      log(`Next threshold → ₹${thresholds[currentIndex]}`);

    } else if (price <= currentThreshold && price >= lastNotifiedPrice) {
      log(`ℹ️ Price ₹${price} is below threshold but NOT lower than last notified (₹${lastNotifiedPrice}).`);

    } else {
      log(`❌ No price drop. Current price ₹${price} is above threshold ₹${currentThreshold}.`);
    }

    log(`😴 No alert this round. Sleeping for ${CHECK_INTERVAL / 60000} minutes...`);
    log("--------------------------------------------------------------\n");

    await new Promise(res => setTimeout(res, CHECK_INTERVAL));
  }

  log("Final threshold reached. Exiting.");
  process.exit(0);
})();

