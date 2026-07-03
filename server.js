const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const axios = require('axios');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const BLYNK_TOKEN = process.env.BLYNK_TOKEN;
const BLYNK_BASE_URL = 'https://blynk.cloud/external/api';

const razorpay = new Razorpay({
  key_id: RAZORPAY_KEY_ID,
  key_secret: RAZORPAY_KEY_SECRET,
});

// ₹20=V1, ₹30=V2, ₹40=V3, ₹50=V4
// Razorpay amount పైసలలో store చేస్తుంది
const AMOUNT_PIN_MAP = {
  2000: 'V1',
  3000: 'V2',
  4000: 'V3',
  5000: 'V4'
};

let lastPayment = null;
let refundTimer = null;

async function triggerBlynk(pin, value) {
  try {
    const url = BLYNK_BASE_URL + '/update?token=' + BLYNK_TOKEN + '&' + pin + '=' + value;
    await axios.get(url);
    console.log('Blynk OK: ' + pin + '=' + value);
  } catch (err) {
    console.log('Blynk error: ' + err.message);
  }
}

async function doRefund(paymentId) {
  try {
    console.log('Refunding:', paymentId);
    const refund = await razorpay.payments.refund(paymentId, {});
    console.log('Refund success:', refund.id);
    await triggerBlynk('V8', 'Refunded!');
  } catch (err) {
    console.log('Refund error:', err.message);
  }
  lastPayment = null;
  refundTimer = null;
}

app.post('/webhook', async (req, res) => {
  try {
    const secret = RAZORPAY_KEY_SECRET;
    const signature = req.headers['x-razorpay-signature'];
    const body = JSON.stringify(req.body);

    const expected = crypto
      .createHmac('sha256', secret)
      .update(body)
      .digest('hex');

    if (signature !== expected) {
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const event = req.body.event;

    if (event === 'payment.captured') {
      const payment = req.body.payload.payment.entity;
      const paymentId = payment.id;
      const amount = payment.amount;
      const timeoutSeconds = 60;

      console.log('Payment received:', paymentId, 'Amount:', amount);

      const vpin = AMOUNT_PIN_MAP[amount];

      if (!vpin) {
        console.log('Wrong amount! Refunding:', amount);
        await triggerBlynk('V8', 'Wrong amount! Refunding...');
        setTimeout(async () => {
          await doRefund(paymentId);
        }, 2000);
        return res.json({ status: 'ok' });
      }

      if (refundTimer) {
        clearTimeout(refundTimer);
        refundTimer = null;
      }

      lastPayment = paymentId;

      await triggerBlynk(vpin, '1');
      await triggerBlynk('V8', 'Payment OK! Starting...');

      console.log('Triggered:', vpin, 'for amount:', amount);

      refundTimer = setTimeout(() => {
        if (lastPayment === paymentId) {
          doRefund(paymentId);
        }
      }, timeoutSeconds * 1000);
    }

    res.json({ status: 'ok' });

  } catch (err) {
    console.log('Webhook error:', err.message);
    res.json({ status: 'error' });
  }
});

app.post('/success', async (req, res) => {
  try {
    console.log('Relay ON success received');

    if (refundTimer) {
      clearTimeout(refundTimer);
      refundTimer = null;
      console.log('Refund timer cancelled');
    }

    lastPayment = null;
    await triggerBlynk('V8', 'Water dispensing...');

    res.json({ success: true });

  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.get('/', (req, res) => res.send('Water Vending Server Running!'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running on port ' + PORT));
