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
let transactions = {};

function getToday() {
  return new Date().toISOString().split('T')[0];
}

function recordTransaction(vendorId, paymentId, amountRupees, status) {
  var date = getToday();
  if (!transactions[vendorId]) transactions[vendorId] = {};
  if (!transactions[vendorId][date]) transactions[vendorId][date] = [];
  var vendor = vendors[vendorId];
  var commissionPct = vendor ? parseInt(vendor.commission) : 10;
  var commission = Math.round(amountRupees * commissionPct / 100);
  var vendorAmount = amountRupees - commission;
  transactions[vendorId][date].push({
    paymentId: paymentId,
    amount: amountRupees,
    commission: commission,
    vendorAmount: vendorAmount,
    status: status,
    time: new Date().toLocaleTimeString('en-IN')
  });
  console.log('Transaction recorded:', vendorId, amountRupees, 'Commission:', commission);
}

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
    var amountRupees = lastPayments[paymentId] ? lastPayments[paymentId].amount / 100 : 0;
    const refund = await razorpay.payments.refund(paymentId, {});
    console.log('Refund success:', refund.id);
    recordTransaction(vendorId, paymentId, amountRupees, 'Refunded');
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

app.get('/pay/:vendorId', function(req, res) {
  var vendorId = req.params.vendorId;
  var vendor = vendors[vendorId];
  if (!vendor) {
    return res.send('<h2>Vendor not found!</h2>');
  }
  res.send(`<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Water Payment</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial;background:linear-gradient(135deg,#1565c0,#42a5f5);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.card{background:white;border-radius:20px;padding:30px;width:100%;max-width:350px;text-align:center;box-shadow:0 10px 30px rgba(0,0,0,0.2)}
.icon{font-size:50px;margin-bottom:15px}
h2{color:#1565c0;margin-bottom:5px;font-size:22px}
p{color:#888;font-size:14px;margin-bottom:20px}
.amounts{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-bottom:20px}
.amt-btn{background:#e3f2fd;color:#1565c0;border:2px solid #90caf9;border-radius:10px;padding:12px 20px;font-size:16px;font-weight:bold;cursor:pointer;transition:all 0.2s}
.amt-btn.selected{background:#1565c0;color:white;border-color:#1565c0}
.amt-btn:hover{background:#1565c0;color:white}
.custom-input{width:100%;padding:15px;border:2px solid #ddd;border-radius:10px;font-size:18px;text-align:center;margin-bottom:20px;outline:none}
.custom-input:focus{border-color:#1565c0}
.pay-btn{background:#1565c0;color:white;border:none;border-radius:10px;padding:15px;width:100%;font-size:18px;font-weight:bold;cursor:pointer}
.pay-btn:hover{background:#0d47a1}
.hint{color:#aaa;font-size:12px;margin-top:10px}
</style>
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
</head>
<body>
<div class="card">
<div class="icon">💧</div>
<h2>Water Vending</h2>
<p>Amount select చేయండి</p>
<div class="amounts">
  <button class="amt-btn" onclick="selectAmt(this,100)">1L.2RS</button>
  <button class="amt-btn" onclick="selectAmt(this,200)">Rs.2</button>
  <button class="amt-btn" onclick="selectAmt(this,300)">Rs.3</button>
  <button class="amt-btn" onclick="selectAmt(this,400)">Rs.4</button>
</div>
<input class="custom-input" type="number" id="amt" placeholder="Amount in Rupees" oninput="clearSelected()">
<button class="pay-btn" onclick="pay()">Pay Now</button>
<p class="hint">Valid: Rs.1, Rs.2, Rs.3, Rs.4 only</p>
</div>
<script>
var selectedAmt = 0;
function selectAmt(btn, amt) {
  document.querySelectorAll('.amt-btn').forEach(function(b){ b.classList.remove('selected'); });
  btn.classList.add('selected');
  selectedAmt = amt;
  document.getElementById('amt').value = '';
}
function clearSelected() {
  document.querySelectorAll('.amt-btn').forEach(function(b){ b.classList.remove('selected'); });
  selectedAmt = 0;
}
function pay() {
  var inputVal = document.getElementById('amt').value;
  var amount = selectedAmt || (inputVal ? parseInt(inputVal) * 100 : 0);
  if (!amount) { alert('Amount enter చేయండి!'); return; }
  var options = {
    key: '${RAZORPAY_KEY_ID}',
    amount: amount,
    currency: 'INR',
    name: 'Water Vending',
    description: 'Water Payment',
    notes: { vendor_id: '${vendorId}' },
    handler: function(response) {
      document.body.innerHTML = '<div style="text-align:center;padding:50px;font-family:Arial"><div style="font-size:60px">✅</div><h2 style="color:#4CAF50;margin:20px 0">Payment Successful!</h2><p style="color:#888">Water dispensing...</p></div>';
    },
    prefill: { contact: '', email: '' },
    theme: { color: '#1565c0' }
  };
  var rzp = new Razorpay(options);
  rzp.open();
}
</script>
</body>
</html>`);
});

const adminHTML = `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Water Vending Admin</title>
<style>
body{font-family:Arial;padding:20px;background:#f0f0f0}
.card{background:white;padding:20px;border-radius:10px;margin-bottom:20px;box-shadow:0 2px 5px rgba(0,0,0,0.1)}
input,select{width:100%;padding:10px;margin:5px 0 15px 0;border:1px solid #ddd;border-radius:5px;box-sizing:border-box}
.btn{color:white;padding:12px 20px;border:none;border-radius:5px;width:100%;font-size:16px;cursor:pointer;margin-bottom:10px;background:#2196F3}
.btn-red{background:#f44336}
.btn-green{background:#4CAF50}
h2{color:#333}
.vc{background:#e3f2fd;padding:15px;border-radius:8px;margin-bottom:10px}
.vc h3{margin:0 0 10px 0;color:#1565c0}
.qb{background:#f5f5f5;padding:10px;border-radius:5px;margin-top:10px;word-break:break-all;font-size:14px}
table{width:100%;border-collapse:collapse;margin-top:10px}
th{background:#1565c0;color:white;padding:8px;font-size:13px}
td{padding:8px;border-bottom:1px solid #eee;font-size:13px}
tr:nth-child(even){background:#f5f5f5}
.status-success{color:#4CAF50;font-weight:bold}
.status-refunded{color:#f44336;font-weight:bold}
.total-row{background:#e3f2fd;font-weight:bold}
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
<button class="btn" id="refreshBtn">Refresh</button>
</div>

<div class="card">
<h2>Transactions Report</h2>
<select id="vendorSelect"><option value="">Select Vendor</option></select>
<input type="date" id="reportDate">
<button class="btn" id="reportBtn">View Report</button>
<div id="reportDiv"></div>
</div>

</div>
<script>
var pwd = '';
document.getElementById('loginBtn').addEventListener('click', function() {
  pwd = document.getElementById('pwd').value;
  fetch('/admin/vendors', { headers: { 'x-admin-password': pwd } })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    if (data.error) { alert('Wrong password!'); return; }
    document.getElementById('loginCard').style.display = 'none';
    document.getElementById('panel').style.display = 'block';
    document.getElementById('reportDate').value = new Date().toISOString().split('T')[0];
    showVendors(data);
    populateVendorSelect(data);
  })
  .catch(function(e) { alert('Error: ' + e.message); });
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
    if (res.success) { alert('Vendor added!'); loadVendors(); }
    else alert('Error: ' + res.error);
  });
});

document.getElementById('refreshBtn').addEventListener('click', function() { loadVendors(); });

document.getElementById('reportBtn').addEventListener('click', function() {
  var vendorId = document.getElementById('vendorSelect').value;
  var date = document.getElementById('reportDate').value;
  if (!vendorId) { alert('Vendor select చేయండి!'); return; }
  fetch('/admin/transactions?vendorId=' + vendorId + '&date=' + date, {
    headers: { 'x-admin-password': pwd }
  })
  .then(function(r) { return r.json(); })
  .then(function(data) { showReport(data, vendorId, date); });
});

function loadVendors() {
  fetch('/admin/vendors', { headers: { 'x-admin-password': pwd } })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    showVendors(data);
    populateVendorSelect(data);
  });
}

function populateVendorSelect(data) {
  var sel = document.getElementById('vendorSelect');
  sel.innerHTML = '<option value="">Select Vendor</option>';
  Object.entries(data).forEach(function(entry) {
    sel.innerHTML += '<option value="' + entry[0] + '">' + entry[1].name + '</option>';
  });
}

function showVendors(data) {
  var div = document.getElementById('vendorsList');
  var keys = Object.keys(data);
  if (keys.length === 0) { div.innerHTML = '<p>No vendors yet!</p>'; return; }
  var html = '';
  keys.forEach(function(id) {
    var v = data[id];
    var payLink = 'https://water-vending-server.onrender.com/pay/' + id;
    var qrLink = 'https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=' + encodeURIComponent(payLink);
    html += '<div class="vc">';
    html += '<h3>' + v.name + '</h3>';
    html += '<p>ID: ' + id + ' | Commission: ' + v.commission + '%</p>';
    html += '<p>Bank: ' + v.bank_account + ' | IFSC: ' + v.bank_ifsc + '</p>';
    html += '<div class="qb">';
    html += '<img src="' + qrLink + '" style="max-width:200px;margin:10px 0"><br>';
    html += '<a href="' + qrLink + '" download="qr_' + id + '.png">Download QR</a>';
    html += '</div>';
    html += '<button class="btn btn-red" data-id="' + id + '" data-action="del">Delete</button>';
    html += '</div>';
  });
  div.innerHTML = html;
  div.querySelectorAll('button[data-action="del"]').forEach(function(btn) {
    btn.addEventListener('click', function() { deleteVendor(this.getAttribute('data-id')); });
  });
}

function showReport(data, vendorId, date) {
  var div = document.getElementById('reportDiv');
  if (!data || data.length === 0) {
    div.innerHTML = '<p style="margin-top:10px;color:#888">No transactions found!</p>';
    return;
  }
  var totalAmount = 0;
  var totalCommission = 0;
  var totalVendor = 0;
  var rows = '';
  data.forEach(function(t) {
    totalAmount += t.amount;
    totalCommission += t.commission;
    totalVendor += t.vendorAmount;
    rows += '<tr>';
    rows += '<td>' + t.time + '</td>';
    rows += '<td style="font-size:11px">' + t.paymentId + '</td>';
    rows += '<td>Rs.' + t.amount + '</td>';
    rows += '<td>Rs.' + t.commission + '</td>';
    rows += '<td>Rs.' + t.vendorAmount + '</td>';
    rows += '<td class="status-' + t.status.toLowerCase() + '">' + t.status + '</td>';
    rows += '</tr>';
  });
  div.innerHTML = '<h3 style="margin:15px 0 10px">' + vendorId + ' - ' + date + '</h3>' +
    '<table><thead><tr><th>Time</th><th>Payment ID</th><th>Amount</th><th>My Commission</th><th>Vendor Amount</th><th>Status</th></tr></thead>' +
    '<tbody>' + rows +
    '<tr class="total-row"><td colspan="2">TOTAL</td><td>Rs.' + totalAmount + '</td><td>Rs.' + totalCommission + '</td><td>Rs.' + totalVendor + '</td><td></td></tr>' +
    '</tbody></table>';
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
    if (res.success) { alert('Deleted!'); loadVendors(); }
  });
}
</script>
</body>
</html>`;

app.get('/admin', function(req, res) { res.send(adminHTML); });

app.get('/admin/vendors', function(req, res) {
  if (req.headers['x-admin-password'] !== ADMIN_PASSWORD) {
    return res.json({ error: 'Unauthorized' });
  }
  res.json(vendors);
});

app.get('/admin/transactions', function(req, res) {
  if (req.headers['x-admin-password'] !== ADMIN_PASSWORD) {
    return res.json({ error: 'Unauthorized' });
  }
  var vendorId = req.query.vendorId;
  var date = req.query.date;
  if (!transactions[vendorId] || !transactions[vendorId][date]) {
    return res.json([]);
  }
  res.json(transactions[vendorId][date]);
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
    commission: parseInt(b.commission) || 10
  };
  console.log('Vendor added:', b.vendorId);
  res.json({ success: true });
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
        lastPayments[paymentId] = { vendorId: vendorId, amount: amount };
        setTimeout(async function() { await doRefund(paymentId, vendorId); }, 2000);
        return res.json({ status: 'ok' });
      }
      var vendor = vendors[vendorId];
      if (!vendor) {
        console.log('Vendor not found! Refunding:', vendorId);
        lastPayments[paymentId] = { vendorId: vendorId, amount: amount };
        setTimeout(async function() { await doRefund(paymentId, vendorId); }, 2000);
        return res.json({ status: 'ok' });
      }
      lastPayments[paymentId] = { vendorId: vendorId, amount: amount, vpin: vpin };
      await triggerBlynk(vendor.blynk_token, vpin, '1');
      await triggerBlynk(vendor.blynk_token, 'V8', 'Payment OK!');
      console.log('Triggered:', vpin, 'for vendor:', vendorId);
      refundTimers[paymentId] = setTimeout(async function() {
        if (lastPayments[paymentId]) { await doRefund(paymentId, vendorId); }
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
        var amountRupees = lastPayments[paymentId].amount / 100;
        recordTransaction(vendorId, paymentId, amountRupees, 'Success');
        clearTimeout(refundTimers[paymentId]);
        delete refundTimers[paymentId];
        delete lastPayments[paymentId];
        console.log('Transaction recorded - amount:', amountRupees);
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

app.get('/', function(req, res) { res.send('Water Vending Server Running!'); });

var PORT = process.env.PORT || 3000;
app.listen(PORT, function() { console.log('Server running on port ' + PORT); });
