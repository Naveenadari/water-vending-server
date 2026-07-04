const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const axios = require('axios');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

const razorpay = new Razorpay({
  key_id: RAZORPAY_KEY_ID,
  key_secret: RAZORPAY_KEY_SECRET,
});

const BLYNK_BASE_URL = 'https://blynk.cloud/external/api';

const AMOUNT_PIN_MAP = {
  100: 'V1',
  200: 'V2',
  300: 'V3',
  400: 'V4'
};

let vendors = {};
let lastPayments = {};
let refundTimers = {};

async function triggerBlynk(token, pin, value) {
  try {
    const url = BLYNK_BASE_URL + '/update?token=' + token + '&' + pin + '=' + value;
    await axios.get(url);
    console.log('Blynk OK: ' + pin + '=' + value);
  } catch (err) {
    console.log('Blynk error: ' + err.message);
  }
}

async function doRefund(paymentId, vendorId) {
  try {
    console.log('Refunding:', paymentId);
    const refund = await razorpay.payments.refund(paymentId, {});
    console.log('Refund success:', refund.id);
    const vendor = vendors[vendorId];
    if (vendor) {
      await triggerBlynk(vendor.blynk_token, 'V8', 'Refunded!');
    }
  } catch (err) {
    console.log('Refund error:', err.message);
  }
  delete lastPayments[paymentId];
  if (refundTimers[paymentId]) {
    clearTimeout(refundTimers[paymentId]);
    delete refundTimers[paymentId];
  }
}

app.get('/admin', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Water Vending Admin</title>
<style>
body { font-family: Arial; padding: 20px; background: #f0f0f0; }
.card { background: white; padding: 20px; border-radius: 10px; margin-bottom: 20px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
input { width: 100%; padding: 10px; margin: 5px 0 15px 0; border: 1px solid #ddd; border-radius: 5px; box-sizing: border-box; }
button { background: #2196F3; color: white; padding: 12px 20px; border: none; border-radius: 5px; width: 100%; font-size: 16px; cursor: pointer; margin-bottom: 10px; }
button.red { background: #f44336; }
button.green { background: #4CAF50; }
button.orange { background: #FF9800; }
h2 { color: #333; }
.vendor-card { background: #e3f2fd; padding: 15px; border-radius: 8px; margin-bottom: 10px; }
.vendor-card h3 { margin: 0 0 10px 0; color: #1565c0; }
.qr-box { background: #f5f5f5; padding: 10px; border-radius: 5px; margin-top: 10px; word-break: break-all; font-size: 12px; }
</style>
</head>
<body>
<div class="card">
<h2>Admin Login</h2>
<input type="password" id="password" placeholder="Enter admin password">
<button onclick="login()">Login</button>
</div>
<div id="panel" style="display:none">
<div class="card">
<h2>Add New Vendor</h2>
<input type="text" id="vendorId" placeholder="Vendor ID (ex: vendor_001)">
<input type="text" id="vendorName" placeholder="Vendor Name">
<input type="text" id="blynkToken" placeholder="Blynk Auth Token">
<input type="text" id="bankAccount" placeholder="Bank Account Number">
<input type="text" id="bankIfsc" placeholder="Bank IFSC Code">
<input type="text" id="bankName" placeholder="Account Holder Name">
<input type="number" id="commission" placeholder="Commission %" value="10">
<button class="green" onclick="addVendor()">Add Vendor</button>
</div>
<div class="card">
<h2>Vendors List</h2>
<div id="vendorsList"></div>
<button onclick="loadVendors()">Refresh List</button>
</div>
</div>
<script>
let pwd = '';
function login() {
  pwd = document.getElementById('password').value;
  fetch('/admin/vendors', { headers: { 'x-admin-password': pwd } })
    .then(r => r.json()).then(data => {
      if (data.error) { alert('Wrong password!'); return; }
      document.getElementById('panel').style.display = 'block';
      showVendors(data);
    });
}
function loadVendors() {
  fetch('/admin/vendors', { headers: { 'x-admin-password': pwd } })
    .then(r => r.json()).then(data => showVendors(data));
}
function showVendors(data) {
  const div = document.getElementById('vendorsList');
  if (Object.keys(data).length === 0) { div.innerHTML = '<p>No vendors yet!</p>'; return; }
  div.innerHTML = Object.entries(data).map(([id, v]) =>
    '<div class="vendor-card">' +
    '<h3>' + v.name + '</h3>' +
    '<p>ID: ' + id + '</p>' +
    '<p>Commission: ' + v.commission + '%</p>' +
    '<p>Bank: ' + v.bank_account + '</p>' +
    (v.payment_link ? '<div class="qr-box">Payment Link: <a href="' + v.payment_link + '" target="_blank">' + v.payment_link + '</a></div>' : '') +
    '<button class="orange" onclick="generateQR(\'' + id + '\')">Generate QR Link</button>' +
    '<button class="red" onclick="deleteVendor(\'' + id + '\')">Delete</button>' +
    '</div>'
  ).join('');
}
function addVendor() {
  const data = {
    vendorId: document.getElementById('vendorId').value,
    name: document.getElementById('vendorName').value,
    blynk_token: document.getElementById('blynkToken').value,
    bank_account: document.getElementById('bankAccount').value,
    bank_ifsc: document.getElementById('bankIfsc').value,
    bank_name: document.getElementById('bankName').value,
    commission: document.getElementById('commission').value
  };
  fetch('/admin/vendors/add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-password': pwd },
    body: JSON.stringify(data)
  }).then(r => r.json()).then(res => {
    if (res.success) { alert('Vendor added!'); loadVendors(); }
    else alert('Error: ' + res.error);
  });
}
function generateQR(vendorId) {
  fetch('/admin/vendors/generate-links', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-password': pwd },
    body: JSON.stringify({ vendorId })
  }).then(r => r.json()).then(res => {
    if (res.success) { alert('QR Link generated!'); loadVendors(); }
    else alert('Error: ' + res.error);
  });
}
function deleteVendor(id) {
  if (!confirm('Delete vendor ' + id + '?')) return;
  fetch('/admin/vendors/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-password': pwd },
    body: JSON.stringify({ vendorId: id })
  }).then(r => r.json()).then(res => {
    if (res.success) { alert('Deleted!'); loadVendors(); }
  });
}
</script>
</body>
</html>
  `);
});

app.get('/admin/vendors', (req, res) => {
  if (req.headers['x-admin-password'] !== ADMIN_PASSWORD) {
    return res.json({ error: 'Unauthorized' });
  }
  res.json(vendors);
});

app.post('/admin/vendors/add', (req, res) => {
  if (req.headers['x-admin-password'] !== ADMIN_PASSWORD) {
    return res.json({ success: false, error: 'Unauthorized' });
  }
  const { vendorId, name, blynk_token, bank_account, bank_ifsc, bank_name, commission } = req.body;
  if (!vendorId || !name || !blynk_token) {
    return res.json({ success: false, error: 'Missing fields' });
  }
  vendors[vendorId] = { name, blynk_token, bank_account, bank_ifsc, bank_name, commission };
  console.log('Vendor added:', vendorId);
  res.json({ success: true });
});

app.post('/admin/vendors/generate-links', async (req, res) => {
  if (req.headers['x-admin-password'] !== ADMIN_PASSWORD) {
    return res.json({ success: false, error: 'Unauthorized' });
  }
  const { vendorId } = req.body;
  const vendor = vendors[vendorId];
  if (!vendor) {
    return res.json({ success: false, error: 'Vendor not found' });
  }
  try {
    const link = await razorpay.paymentLink.create({
      amount: 0,
      currency: 'INR',
      description: 'Water - ' + vendorId,
      notes: { vendor_id: vendorId },
      reminder_enable: false
    });
    vendors[vendorId].payment_link = link.short_url;
    console.log('Link created for vendor:', vendorId, link.short_url);
    res.json({ success: true });
  } catch (err) {
    console.log('Generate link error:', err.message);
    res.json({ success: false, error: err.message });
  }
});

app.post('/admin/vendors/delete', (req, res) => {
  if (req.headers['x-admin-password'] !== ADMIN_PASSWORD) {
    return res.json({ success: false, error: 'Unauthorized' });
  }
  delete vendors[req.body.vendorId];
  res.json({ success: true });
});

app.post('/webhook', async (req, res) => {
  try {
    const secret = RAZORPAY_KEY_SECRET;
    const signature = req.headers['x-razorpay-signature'];
    const body = JSON.stringify(req.body);
    const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
    if (signature !== expected) {
      return res.status(400).json({ error: 'Invalid signature' });
    }
    const event = req.body.event;
    if (event === 'payment.captured') {
      const payment = req.body.payload.payment.entity;
      const paymentId = payment.id;
      const amount = payment.amount;
      const vendorId = payment.notes && payment.notes.vendor_id;
      const timeoutSeconds = 60;
      console.log('Payment:', paymentId, 'Amount:', amount, 'Vendor:', vendorId);
      const vpin = AMOUNT_PIN_MAP[amount];
      if (!vpin) {
        console.log('Wrong amount! Refunding:', amount);
        setTimeout(async () => { await doRefund(paymentId, vendorId); }, 2000);
        return res.json({ status: 'ok' });
      }
      const vendor = vendors[vendorId];
      if (!vendor) {
        console.log('Vendor not found! Refunding:', vendorId);
        setTimeout(async () => { await doRefund(paymentId, vendorId); }, 2000);
        return res.json({ status: 'ok' });
      }
      lastPayments[paymentId] = { vendorId, amount, vpin };
      await triggerBlynk(vendor.blynk_token, vpin, '1');
      await triggerBlynk(vendor.blynk_token, 'V8', 'Payment OK!');
      console.log('Triggered:', vpin, 'for vendor:', vendorId);
      refundTimers[paymentId] = setTimeout(() => {
        if (lastPayments[paymentId]) { doRefund(paymentId, vendorId); }
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
    const { vendorId } = req.body;
    console.log('Relay ON success:', vendorId);
    Object.keys(refundTimers).forEach(paymentId => {
      if (lastPayments[paymentId] && lastPayments[paymentId].vendorId === vendorId) {
        clearTimeout(refundTimers[paymentId]);
        delete refundTimers[paymentId];
        delete lastPayments[paymentId];
        console.log('Refund timer cancelled');
      }
    });
    const vendor = vendors[vendorId];
    if (vendor) {
      await triggerBlynk(vendor.blynk_token, 'V8', 'Water dispensing...');
    }
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.get('/', (req, res) => res.send('Water Vending Server Running!'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running on port ' + PORT));
