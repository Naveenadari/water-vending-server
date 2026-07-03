
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

let pendingPayments = {};

async function triggerBlynk(pin, value) {
  try {
    const url = BLYNK_BASE_URL + '/update?token=' + BLYNK_TOKEN + '&' + pin + '=' + value;
    await axios.get(url);
    console.log('Blynk triggered: ' + pin + '=' + value);
  } catch (err) {
    console.log('Blynk error: ' + err.message);
  }
}

async function autoRefund(paymentId) {
  try {
    if (!pendingPayments[paymentId]) return;
    if (pendingPayments[paymentId].status !== 'pending') return;

    console.log('Auto refund triggered:', paymentId);
    pendingPayments[paymentId].status = 'refunding';

    const refund = await razorpay.payments.refund(paymentId, {});
    console.log('Auto refund success:', refund.id);

    delete pendingPayments[paymentId];

    await triggerBlynk('V8', 'Refunded!');

  } catch (err) {
    console.log('Auto refund error:', err.message);
    delete pendingPayments[paymentId];
  }
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
      const timeoutSeconds = 60;

      console.log('Payment received:', paymentId);

      pendingPayments[paymentId] = {
        id: paymentId,
        amount: payment.amount,
        time: Date.now(),
        status: 'pending',
        timeout: timeoutSeconds
      };

      // V1 trigger
      await triggerBlynk('V1', '1');

      // Payment ID V7 కి
      await triggerBlynk('V7', paymentId);

      console.log('Blynk triggered for:', paymentId);

      // Auto refund timer
      setTimeout(() => {
        autoRefund(paymentId);
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
    const { paymentId } = req.body;

    if (!paymentId || !pendingPayments[paymentId]) {
      return res.json({ success: false, error: 'Payment not found' });
    }

    pendingPayments[paymentId].status = 'success';
    console.log('Relay ON success:', paymentId);
    delete pendingPayments[paymentId];

    res.json({ success: true });

  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.post('/refund', async (req, res) => {
  try {
    const { paymentId } = req.body;
    if (!paymentId) {
      return res.json({ success: false, error: 'No payment ID' });
    }
    await autoRefund(paymentId);
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.get('/', (req, res) => res.send('Water Vending Server Running!'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running on port ' + PORT));
