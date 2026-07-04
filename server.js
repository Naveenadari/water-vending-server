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

const adminHTML = `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Water Vending Admin</title>
<style>
body{font-family:Arial;padding:20px;background:#f0f0f0}
.card{background:white;padding:20px;border-radius:10px;margin-bottom:20px;box-shadow:0 2px 5px rgba(0,0,0,0.1)}
input{width:100%;padding:10px;margin:5px 0 15px 0;border:1px solid #ddd;border-radius:5px;box-sizing:border-box}
.btn{color:white;padding:12px 20px;border:none;border-radius:5px;width:100%;font-size:16px;cursor:pointer;margin-bottom:10px;background:#2196F3}
.btn-red{background:#f44336}
.btn-green{background:#4CAF50}
.btn-orange{background:#FF9800}
h2{color:#333}
.vc{background:#e3f2fd;padding:15px;border-radius:8px;margin-bottom:10px}
.vc h3{margin:0 0 10px 0;color:#1565c0}
.qb{background:#f5f5f5;padding:10px;border-radius:5px;margin-top:10px;word-break:break-all;font-size:12px}
</style>
</head>
<body>
<div class="card" id="loginCard">
<h2>Admin Login</h2>
<input type="password" id="pwd" placeholder="Enter admin password">
<button class="btn" id="loginBtn">Login</button>
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
<button class="btn btn-green" id="addBtn">Add Vendor</button>
</div>
<div class="card">
<h2>Vendors List</h2>
<div id="vendorsList">Loading...</div>
<button class="btn" id="refreshBtn">Refresh List</button>
</div>
</div>
<script>
var pwd = '';

document.getElementById('loginBtn').addEventListener('click', function() {
  pwd = document.getElementById('pwd').value;
  fetch('/admin/vendors', {
    headers: { 'x-admin-password': pwd }
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    if (data.error) {
      alert('Wrong password!');
      return;
    }
    document.getElementById('loginCard').style.display = 'none';
    document.getElementById('panel').style.display = 'block';
    showVendors(data);
  })
  .catch(function(e) {
    alert('Error: ' + e.message);
  });
});

document.getElementById('addBtn').addEventListener('click', function() {
  var data = {
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
  })
  .then(function(r) { return r.json(); })
  .then(function(res) {
    if (res.success) {
      alert('Vendor added!');
      loadVendors();
    } else {
      alert('Error: ' + res.error);
    }
  });
});

document.getElementById('refreshBtn').addEventListener('click', function() {
  loadVendors();
});

function loadVendors() {
  fetch('/admin/vendors', { headers: { 'x-admin-password': pwd } })
  .then(function(r) { return r.json(); })
  .then(function(data) { showVendors(data); });
}

function showVendors(data) {
  var div = document.getElementById('vendorsList');
  var keys = Object.keys(data);
  if (keys.length === 0) {
    div.innerHTML = '<p>No vendors yet!</p>';
    return;
  }
  var html = '';
  keys.forEach(function(id) {
    var v = data[id];
    html += '<div class="vc">';
    html += '<h3>' + v.name + '</h3>';
    html += '<p>ID: ' + id + '</p>';
    html += '<p>Commission: ' + v.commission + '%</p>';
    html += '<p>Bank: ' + v.bank_account + '</p>';
    if (v.payment_link) {
      html += '<div class="qb">Payment Link: <a href="' + v.payment_link + '" target="_blank">' + v.payment_link + '</a></div>';
    }
    html += '<button class="btn btn-orange" data-id="' + id + '" data-action="qr">Generate QR Link</button>';
    html += '<button class="btn btn-red" data-id="' + id + '" data-action="del">Delete</button>';
    html += '</div>';
  });
  div.innerHTML = html;

  div.querySelectorAll('button[data-action="qr"]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      generateQR(this.getAttribute('data-id'));
    });
  });

  div.querySelectorAll('button[data-action="del"]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      deleteVendor(this.getAttribute('data-id'));
    });
  });
}

function generateQR(vendorId) {
  fetch('/admin/vendors/generate-links', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-password': pwd },
    body: JSON.stringify({ vendorId: vendorId })
  })
  .then(function(r) { return r.json(); })
  .then(function(res) {
    if (res.success) {
      alert('QR Link generated!');
      loadVendors();
    } else {
      alert('Error: ' + res.error);
    }
  });
}

function deleteVendor(id) {
  if (!confirm('Delete vendor ' + id + '?')) return;
  fetch('/admin/vendors/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-password': pwd },
    body: JSON.stringify({ vendorId: id })
  })
  .then(function(r) { return r.json(); })
  .then(function(res) {
    if (res.success) {
      alert('Deleted!');
      loadVendors();
    }
  });
}
</script>
</body>
</html>`;

app.get('/admin', function(req, res) {
  res.send(adminHTML);
});

app.get('/admin/vendors', function(req, res) {
  if (req.headers['x-admin-password'] !== ADMIN_PASSWORD) {
    return res.json({ error: 'Unauthorized' });
  }
  res.json(vendors);
});

app.post('/admin/vendors/add', function(req, res) {
  if (req.headers['x-admin-password'] !== ADMIN_PASSWORD) {
    return res.json({ success: false, error: 'Unauthorized' });
  }
  var b = req.body;
  if (!b.vendorId || !b.name || !b.blynk_token) {
    return res.json({ success: false, error: 'Missing fields' });
  }
  vendors[b.vendorId] = {
    name: b.name,
    blynk_token: b.blynk_token,
    bank_account: b.bank_account,
    bank_ifsc: b.bank_ifsc,
    bank_name: b.bank_name,
    commission: b.commission
  };
  console.log('Vendor added:', b.vendorId);
  res.json({ success: true });
});

app.post('/admin/vendors/generate-links', async function(req, res) {
  if (req.headers['x-admin-password'] !== ADMIN_PASSWORD) {
    return res.json({ success: false, error: 'Unauthorized' });
  }
  var vendorId = req.body.vendorId;
  var vendor = vendors[vendorId];
  if (!vendor) {
    return res.json({ success: false, error: 'Vendor not found' });
  }
  try {
    var link = await razorpay.qrCode.create({
  type: 'upi_qr',
  name: vendorId,
  usage: 'multiple_use',
  fixed_amount: false,
  description: 'Water - ' + vendorId,
  notes: { vendor_id: vendorId }
});
    vendors[vendorId].payment_link = link.short_url;
    console.log('Link created:', vendorId, link.short_url);
    res.json({ success: true });
  } catch (err) {
    console.log('Generate link error:', err.message);
    res.json({ success: false, error: err.message });
  }
});

app.post('/admin/vendors/delete', function(req, res) {
  if (req.headers['x-admin-password'] !== ADMIN_PASSWORD) {
    return res.json({ success: false, error: 'Unauthorized' });
  }
  delete vendors[req.body.vendorId];
  res.json({ success: true });
});

app.post('/webhook', async function(req, res) {
  try {
    var secret = RAZORPAY_KEY_SECRET;
    var signature = req.headers['x-razorpay-signature'];
    var body = JSON.stringify(req.body);
    var expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
    if (signature !== expected) {
      return res.status(400).json({ error: 'Invalid signature' });
    }
    var event = req.body.event;
    if (event === 'payment.captured') {
      var payment = req.body.payload.payment.entity;
      var paymentId = payment.id;
      var amount = payment.amount;
      var vendorId = payment.notes && payment.notes.vendor_id;
      var timeoutSeconds = 60;
      console.log('Payment:', paymentId, 'Amount:', amount, 'Vendor:', vendorId);
      var vpin = AMOUNT_PIN_MAP[amount];
      if (!vpin) {
        console.log('Wrong amount! Refunding:', amount);
        setTimeout(async function() { await doRefund(paymentId, vendorId); }, 2000);
        return res.json({ status: 'ok' });
      }
      var vendor = vendors[vendorId];
      if (!vendor) {
        console.log('Vendor not found! Refunding:', vendorId);
        setTimeout(async function() { await doRefund(paymentId, vendorId); }, 2000);
        return res.json({ status: 'ok' });
      }
      lastPayments[paymentId] = { vendorId: vendorId, amount: amount, vpin: vpin };
      await triggerBlynk(vendor.blynk_token, vpin, '1');
      await triggerBlynk(vendor.blynk_token, 'V8', 'Payment OK!');
      console.log('Triggered:', vpin, 'for vendor:', vendorId);
      refundTimers[paymentId] = setTimeout(async function() {
        if (lastPayments[paymentId]) {
          await doRefund(paymentId, vendorId);
        }
      }, timeoutSeconds * 1000);
    }
    res.json({ status: 'ok' });
  } catch (err) {
    console.log('Webhook error:', err.message);
    res.json({ status: 'error' });
  }
});

app.post('/success', async function(req, res) {
  try {
    var vendorId = req.body.vendorId;
    console.log('Relay ON success:', vendorId);
    Object.keys(refundTimers).forEach(function(paymentId) {
      if (lastPayments[paymentId] && lastPayments[paymentId].vendorId === vendorId) {
        clearTimeout(refundTimers[paymentId]);
        delete refundTimers[paymentId];
        delete lastPayments[paymentId];
        console.log('Refund timer cancelled');
      }
    });
    var vendor = vendors[vendorId];
    if (vendor) {
      await triggerBlynk(vendor.blynk_token, 'V8', 'Water dispensing...');
    }
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.get('/', function(req, res) {
  res.send('Water Vending Server Running!');
});

var PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
  console.log('Server running on port ' + PORT);
});
