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

// Payment store చేయడానికి
let pendingPayments = {};

// Webhook - payment వచ్చినప్పుడు
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

      console.log('Payment received:', paymentId);

      // Payment store చేయడం
      pendingPayments[paymentId] = {
        id: paymentId,
        amount: payment.amount,
        time: Date.now(),
        status: 'pending'
      };

      // Blynk కి V1 trigger
      await axios.get(BLYNK_BASE_URL + '/update?token=' + BLYNK_TOKEN + '&V1=1');

      // Payment ID ని V7 కి పంపడం
      await axios.get(BLYNK_BASE_URL + '/update?token=' + BLYNK_TOKEN + '&V7=' + paymentId);

      console.log('Blynk triggered for:', paymentId);
    }

    res.json({ status: 'ok' });

  } catch (err) {
    console.log('Webhook error:', err.message);
    res.json({ status: 'error' });
  }
});

// ESP8266 నుండి relay ON success వచ్చినప్పుడు
app.post('/success', async (req, res) => {
  try {
    const { paymentId } = req.body;

    if (!paymentId || !pendingPayments[paymentId]) {
      return res.json({ success: false, error: 'Payment not found' });
    }

    pendingPayments[paymentId].status = 'success';
    console.log('Relay ON success:', paymentId);

    // ఇక్కడ vendor కి transfer చేయవచ్చు (future)
    delete pendingPayments[paymentId];

    res.json({ success: true });

  } catch (err) {
    console.log('Success error:', err.message);
    res.json({ success: false, error: err.message });
  }
});

// ESP8266 నుండి refund request వచ్చినప్పుడు
app.post('/refund', async (req, res) => {
  try {
    const { paymentId } = req.body;

    if (!paymentId) {
      return res.json({ success: false, error: 'No payment ID' });
    }

    console.log('Refund request:', paymentId);

    const refund = await razorpay.payments.refund(paymentId, {});

    if (pendingPayments[paymentId]) {
      delete pendingPayments[paymentId];
    }

    console.log('Refund done:', refund.id);
    res.json({ success: true, refund });

  } catch (err) {
    console.log('Refund error:', err.message);
    res.json({ success: false, error: err.message });
  }
});

app.get('/', (req, res) => res.send('Water Vending Server Running!'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running on port ' + PORT));
