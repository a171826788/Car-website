require('dotenv').config();
const fs = require('fs');
const path = require('path');
const twilio = require('twilio');
const brevo = require('@getbrevo/brevo');

/* ═══════════════════════════════════════════════════════════════
   SANDBOX OPT-IN CHECKER Check if user is allowed to receive WhatsApp
   ═══════════════════════════════════════════════════════════════ */
const SANDBOX_MODE = true; // Set to false when you upgrade to production
const SANDBOX_TEST_NUMBERS = process.env.SANDBOX_TEST_NUMBERS?.split(',') || ['+919359873623'];

function isUserOptedIntoSandbox(phoneNumber) {
  if (!SANDBOX_MODE) return true; // Production doesn't have this restriction
  
  const normalized = normalizePhoneNumber(phoneNumber);
  const isTestNumber = SANDBOX_TEST_NUMBERS.some(testNum => {
    const normTestNum = normalizePhoneNumber(testNum);
    return normTestNum === normalized;
  });
  
  return isTestNumber;
}

function getSandboxOptInInstructions() {
  if (!SANDBOX_MODE) return '';
  
  return `
    
⚠️  SANDBOX MODE Recipient Opt-In Required
────────────────────────────────────────────────────────────
Your Twilio WhatsApp is in SANDBOX mode. Recipients must opt-in first:

1. Have the user send this WhatsApp message:
   TO: +1 415 523 8886
   TEXT: join quite-aware

2. Wait for Twilio confirmation (1-2 minutes)

3. Then your app can send messages for 24 hours

🔗 Learn more: https://www.twilio.com/console/sms/whatsapp/sandbox

Upgrade to Production to remove this limitation!
────────────────────────────────────────────────────────────`;
}

/* ─── LOGO ─── */
let cachedLogoAttachment = null;
let logoReadAttempted = false;

function getLogoAttachment() {
  if (logoReadAttempted) return cachedLogoAttachment;
  logoReadAttempted = true;
  const logoPath = path.join(__dirname, '..', 'assets', 'logo1.png');
  try {
    const fileBuffer = fs.readFileSync(logoPath);
    cachedLogoAttachment = { name: 'logo1.png', content: fileBuffer.toString('base64') };
    console.log('✅ Email logo loaded for embedding:', logoPath);
  } catch (err) {
    console.warn('⚠️ Email logo not found at', logoPath, 'emails will send without logo image.');
    cachedLogoAttachment = null;
  }
  return cachedLogoAttachment;
}

function getLogoImgTag(width = 64) {
  const attachment = getLogoAttachment();
  if (attachment) {
    return `<img src="cid:${attachment.name}" width="${width}" alt="Aman Tour and Travels" style="display:block;border-radius:50%;border:3px solid #D9A441;" />`;
  }
  const publicUrl = env('LOGO_URL');
  if (publicUrl) {
    return `<img src="${publicUrl}" width="${width}" alt="Aman Tour and Travels" style="display:block;border-radius:50%;border:3px solid #D9A441;" />`;
  }
  return '';
}

/* ─── ENV HELPERS ─── */
function env(name, fallback = '') {
  const v = process.env[name];
  return typeof v === 'string' ? v.trim() : fallback;
}

function maskSecret(v) {
  if (!v) return '(missing)';
  if (v.length <= 8) return '****';
  return `${v.slice(0, 4)}...${v.slice(-4)} (len ${v.length})`;
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

/* ─── BREVO INITIALIZATION ─── */
let brevoApiInstance = null;
let brevoInitError = null;

function getBrevoClient() {
  if (brevoInitError) return null;
  if (brevoApiInstance) return brevoApiInstance;

  const apiKey = env('BREVO_API_KEY');
  if (!apiKey) {
    brevoInitError = 'BREVO_API_KEY not set';
    console.warn('⚠️ Brevo: BREVO_API_KEY missing');
    return null;
  }

  try {
    if (typeof brevo.BrevoClient === 'function') {
      brevoApiInstance = new brevo.BrevoClient({ apiKey });
      console.log('✅ Brevo client initialized (BrevoClient API) key:', maskSecret(apiKey));
      return brevoApiInstance;
    }
    if (typeof brevo.TransactionalEmailsApi === 'function') {
      const api = new brevo.TransactionalEmailsApi();
      if (typeof api.setApiKey === 'function' && brevo.TransactionalEmailsApiApiKeys) {
        api.setApiKey(brevo.TransactionalEmailsApiApiKeys.apiKey, apiKey);
      } else if (api.authentications?.['api-key']) {
        api.authentications['api-key'].apiKey = apiKey;
      } else if (api.authentications?.apiKey) {
        api.authentications.apiKey.apiKey = apiKey;
      } else {
        throw new Error('Unsupported legacy Brevo SDK auth shape');
      }
      brevoApiInstance = api;
      console.log('✅ Brevo client initialized (legacy TransactionalEmailsApi) key:', maskSecret(apiKey));
      return brevoApiInstance;
    }
    throw new Error(`Unrecognized @getbrevo/brevo SDK shape. Exports: ${Object.keys(brevo).join(', ')}`);
  } catch (err) {
    brevoInitError = err.message;
    console.error('❌ Brevo init error:', err.message);
    return null;
  }
}

async function sendBrevoEmail(payload) {
  const client = getBrevoClient();
  if (!client) throw new Error(brevoInitError || 'Brevo not configured');
  if (client?.transactionalEmails?.sendTransacEmail) {
    return client.transactionalEmails.sendTransacEmail(payload);
  }
  if (typeof client.sendTransacEmail === 'function') {
    const sendSmtpEmail = typeof brevo.SendSmtpEmail === 'function' ? new brevo.SendSmtpEmail() : {};
    Object.assign(sendSmtpEmail, payload);
    return client.sendTransacEmail(sendSmtpEmail);
  }
  throw new Error('Brevo client does not expose a supported sendTransacEmail method');
}

/* ─── TWILIO INITIALIZATION ─── */
let twilioClient = null;
let twilioInitError = null;

function getTwilioClient() {
  if (twilioInitError) return null;
  if (twilioClient) return twilioClient;

  const accountSid = env('TWILIO_ACCOUNT_SID');
  const authToken = env('TWILIO_AUTH_TOKEN');

  if (!accountSid || !authToken) {
    twilioInitError = 'Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN';
    console.warn('⚠️ Twilio: Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN');
    return null;
  }
  if (!/^AC[a-zA-Z0-9]{32}$/.test(accountSid)) {
    twilioInitError = `Invalid TWILIO_ACCOUNT_SID (${maskSecret(accountSid)}). It must start with "AC" and be 34 characters total.`;
    console.error('❌ Twilio init error:', twilioInitError);
    return null;
  }
  try {
    twilioClient = twilio(accountSid, authToken);
    console.log('✅ Twilio client initialized SID:', maskSecret(accountSid));
    
    // ✅ Log sandbox mode status
    if (SANDBOX_MODE) {
      console.log('📱 WhatsApp SANDBOX MODE ACTIVE');
      console.log('   Test recipients:', SANDBOX_TEST_NUMBERS.join(', '));
      console.log('   Opt-in required: YES');
      console.log('   Each message valid for: 24 hours');
    } else {
      console.log('🌍 WhatsApp PRODUCTION MODE');
    }
    
    return twilioClient;
  } catch (err) {
    twilioInitError = err.message;
    console.error('❌ Twilio init error:', err.message);
    return null;
  }
}

/* ─── PHONE / WHATSAPP NORMALIZATION ─── */
function normalizePhoneNumber(phone) {
  if (!phone) return null;
  const raw = String(phone).trim();
  const hasPlus = raw.startsWith('+');
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 10 && /^[6-9]/.test(digits)) return `+91${digits}`;
  if (digits.length >= 11) return hasPlus ? `+${digits}` : `+${digits}`;
  return null;
}

function toWhatsAppAddress(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  return trimmed.startsWith('whatsapp:') ? trimmed : `whatsapp:${trimmed}`;
}

/* ─── EMAIL TEMPLATES ─── */
function formatBookingDate(date) {
  if (!date) return 'N/A';
  return new Date(date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatBookingTime(date) {
  if (!date) return 'N/A';
  return new Date(date).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function formatCurrency(value) {
  if (value === null || value === undefined || value === '') return '—';
  return `₹ ${Number(value).toLocaleString('en-IN')}`;
}

function emailRow(label, value) {
  return `
    <tr>
      <td style="padding:12px 20px;border-bottom:1px solid #F0EAE0;font-size:13px;font-weight:600;color:#7a6a64;width:38%;">${label}</td>
      <td style="padding:12px 20px;border-bottom:1px solid #F0EAE0;font-size:13.5px;font-weight:600;color:#2A1A1A;">${value}</td>
    </tr>`;
}

function emailShell({ badgeText, badgeColor, headline, introLine, bodyTableRows, footerNote }) {
  const logoTag = getLogoImgTag(60);
  return `
  <div style="background:#F5EFE6;padding:32px 12px;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" style="max-width:600px;margin:0 auto;border-collapse:collapse;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 4px 18px rgba(26,16,16,0.08);">
      <tr>
        <td style="background:linear-gradient(135deg,#6E1F2B,#4d1520);padding:28px 24px;text-align:center;">
          ${logoTag ? `<div style="margin-bottom:10px;">${logoTag.replace('<img ', '<img style="margin:0 auto;" ')}</div>` : ''}
          <div style="font-family:Georgia,serif;font-size:20px;font-weight:700;color:#ffffff;letter-spacing:1px;">AMAN TOUR AND TRAVELS</div>
          <div style="font-size:11.5px;color:#D9A441;letter-spacing:2px;text-transform:uppercase;margin-top:2px;">Safe Journey, Happy Journey</div>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 24px 0;text-align:center;">
          <span style="display:inline-block;background:${badgeColor};color:#ffffff;font-size:12px;font-weight:700;letter-spacing:0.5px;padding:6px 18px;border-radius:50px;">${badgeText}</span>
        </td>
      </tr>
      <tr>
        <td style="padding:14px 28px 4px;text-align:center;">
          <h1 style="margin:0;font-family:Georgia,serif;font-size:21px;color:#2A1A1A;">${headline}</h1>
        </td>
      </tr>
      <tr>
        <td style="padding:0 28px 20px;text-align:center;">
          <p style="margin:0;font-size:13.5px;color:#7a6a64;line-height:1.6;">${introLine}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:0 20px 8px;">
          <table role="presentation" width="100%" style="border-collapse:collapse;background:#FFFDF9;border:1px solid #F0EAE0;border-radius:10px;overflow:hidden;">
            ${bodyTableRows}
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 28px 8px;text-align:center;">
          <p style="margin:0;font-size:12.5px;color:#7a6a64;line-height:1.7;">${footerNote}</p>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 24px 28px;text-align:center;border-top:1px solid #F0EAE0;">
          <p style="margin:0 0 4px;font-size:12px;color:#A35334;font-weight:700;">Aman Tour and Travels</p>
          <p style="margin:0;font-size:11.5px;color:#7a6a64;">Y-325B, Sector 12, Noida, 201301 &nbsp;|&nbsp; +91 6205956801</p>
          <p style="margin:4px 0 0;font-size:11px;color:#b8a99f;">This is an automated email please do not reply directly.</p>
        </td>
      </tr>
    </table>
  </div>`;
}

function buildUserConfirmationEmailHTML(booking) {
  const bookingDate = formatBookingDate(booking.pickupDate);
  const bookingTime = formatBookingTime(booking.pickupDate);
  const vehicleInfo = booking.vehicleId
    ? `${booking.vehicleId.name || ''} ${booking.vehicleId.type ? `(${booking.vehicleId.type})` : ''}`.trim()
    : 'TBD';

  const rows =
    emailRow('Booking ID', booking.bookingId || 'N/A') +
    emailRow('Name', booking.name || 'N/A') +
    emailRow('Pickup', booking.pickupLocation || 'N/A') +
    emailRow('Drop', booking.dropoffLocation || 'N/A') +
    emailRow('Date', bookingDate) +
    emailRow('Time', bookingTime) +
    emailRow('Trip Type', booking.tripType || 'One Way') +
    emailRow('Passengers', booking.numberOfPeople || 1) +
    emailRow('Vehicle', vehicleInfo) +
    emailRow('Estimated Fare', `<span style="color:#6E1F2B;font-weight:700;">${formatCurrency(booking.totalPrice)}</span>`);

  return emailShell({
    badgeText: 'BOOKING RECEIVED',
    badgeColor: '#D9A441',
    headline: `Thank you, ${booking.name || 'Traveller'}!`,
    introLine: "We've received your booking request. Our team will review and confirm it shortly.",
    bodyTableRows: rows,
    footerNote: "We'll reach out with your driver and vehicle details before your trip."
  });
}

function buildAdminNotificationEmailHTML(booking) {
  const bookingDate = formatBookingDate(booking.pickupDate);
  const rows =
    emailRow('Booking ID', booking.bookingId || 'N/A') +
    emailRow('Customer', booking.name || 'N/A') +
    emailRow('Phone', booking.phone || 'N/A') +
    emailRow('Email', booking.email || 'N/A') +
    emailRow('Route', `${booking.pickupLocation || 'N/A'} → ${booking.dropoffLocation || 'N/A'}`) +
    emailRow('Date', bookingDate) +
    emailRow('Passengers', booking.numberOfPeople || 1) +
    emailRow('Fare', formatCurrency(booking.totalPrice)) +
    emailRow('Status', '<span style="color:#D9A441;font-weight:700;">PENDING</span>');

  return emailShell({
    badgeText: 'ACTION REQUIRED',
    badgeColor: '#6E1F2B',
    headline: 'New Booking Received',
    introLine: 'A new booking has come in and needs confirmation.',
    bodyTableRows: rows,
    footerNote: 'Log in to the admin dashboard to confirm and assign a vehicle.'
  });
}

/* ─── WHATSAPP TEMPLATES ─── */
function buildUserWhatsAppMessage(booking) {
  const bookingDate = formatBookingDate(booking.pickupDate);
  const totalFare = booking.totalPrice != null ? `Rs ${Number(booking.totalPrice).toLocaleString('en-IN')}` : 'TBD';

  return `Booking Confirmed - Aman Tour and Travels

Booking ID: ${booking.bookingId}
Name: ${booking.name || 'N/A'}
From: ${booking.pickupLocation || 'N/A'}
To: ${booking.dropoffLocation || 'N/A'}
Date: ${bookingDate}
Trip Type: ${booking.tripType || 'One Way'}
Passengers: ${booking.numberOfPeople || 1}
Estimated Fare: ${totalFare}

We will contact you shortly with driver details.`;
}

function buildAdminWhatsAppMessage(booking) {
  const bookingDate = formatBookingDate(booking.pickupDate);
  const totalFare = booking.totalPrice != null ? `Rs ${Number(booking.totalPrice).toLocaleString('en-IN')}` : 'TBD';

  return `New Booking Alert

Booking ID: ${booking.bookingId}
Customer: ${booking.name || 'N/A'}
Phone: ${booking.phone || 'N/A'}
Route: ${booking.pickupLocation || 'N/A'} to ${booking.dropoffLocation || 'N/A'}
Date: ${bookingDate}
Passengers: ${booking.numberOfPeople || 1}
Fare: ${totalFare}

Status: PENDING - confirm and assign vehicle`;
}

/* ─── EMAIL SENDER ─── */
async function sendEmail(recipientEmail, recipientName, subject, htmlContent, includeLogo = true) {
  if (!recipientEmail || !isValidEmail(recipientEmail)) {
    console.log(`⏭️ Email skipped invalid recipient email: ${recipientEmail || '(missing)'}`);
    return { success: false, reason: 'Invalid recipient email', email: recipientEmail || null };
  }
  const senderEmail = env('SENDER_EMAIL');
  if (!senderEmail || !isValidEmail(senderEmail)) {
    console.log('⏭️ Email skipped SENDER_EMAIL is missing or invalid');
    return { success: false, reason: 'Invalid sender email', email: recipientEmail };
  }
  const payload = {
    sender: { name: env('SENDER_NAME') || 'Aman Tour and Travels', email: senderEmail },
    to: [{ email: recipientEmail, name: recipientName || 'User' }],
    subject: subject || 'Notification',
    htmlContent: htmlContent || '<p>No content</p>'
  };
  if (includeLogo) {
    const logoAttachment = getLogoAttachment();
    if (logoAttachment) payload.attachment = [logoAttachment];
  }
  const replyTo = env('REPLY_TO');
  if (replyTo && isValidEmail(replyTo)) payload.replyTo = { email: replyTo };

  try {
    const result = await sendBrevoEmail(payload);
    const messageId = result?.messageId || result?.data?.messageId || result?.body?.messageId || null;
    console.log(`✅ Email sent to ${recipientEmail}${messageId ? ` (ID: ${messageId})` : ''}`);
    return { success: true, email: recipientEmail, messageId };
  } catch (err) {
    const detail = err?.response?.body?.message || err?.body?.message || err?.rawResponse?.body?.message || err?.message || 'Unknown email error';
    console.error(`❌ Email failed to ${recipientEmail}:`, detail);
    return { success: false, email: recipientEmail, error: detail };
  }
}

/* ═══════════════════════════════════════════════════════════════
   WHATSAPP SENDER WITH SANDBOX ERROR HANDLING
   ═══════════════════════════════════════════════════════════════ */
async function sendWhatsApp(phoneNumber, message) {
  const client = getTwilioClient();
  if (!client) {
    console.log(`⏭️ WhatsApp skipped to ${phoneNumber || '(missing)'} Twilio not configured`);
    return { success: false, reason: twilioInitError || 'Twilio not configured', phone: phoneNumber || null };
  }

  const rawFrom = env('TWILIO_WHATSAPP_FROM');
  if (!rawFrom) {
    console.log('⏭️ WhatsApp skipped TWILIO_WHATSAPP_FROM not configured');
    return { success: false, reason: 'Sender not configured', phone: phoneNumber || null };
  }

  const normalizedPhone = normalizePhoneNumber(phoneNumber);
  if (!normalizedPhone) {
    console.log(`⏭️ WhatsApp skipped invalid phone format: ${phoneNumber || '(missing)'}`);
    return { success: false, reason: 'Invalid phone format', phone: phoneNumber || null };
  }

  // ✅ CHECK SANDBOX OPT-IN
  if (SANDBOX_MODE && !isUserOptedIntoSandbox(normalizedPhone)) {
    console.log(`⏭️ WhatsApp skipped recipient not opted into sandbox`);
    console.log(getSandboxOptInInstructions());
    return { 
      success: false, 
      reason: 'Sandbox opt-in required', 
      phone: normalizedPhone,
      sandboxOptInNeeded: true,
      instructions: getSandboxOptInInstructions()
    };
  }

  const fromAddress = toWhatsAppAddress(rawFrom);
  const toAddress = toWhatsAppAddress(normalizedPhone);

  try {
    const result = await client.messages.create({
      body: message || '',
      from: fromAddress,
      to: toAddress
    });

    console.log(`✅ WhatsApp accepted by Twilio for ${normalizedPhone} (SID: ${result.sid}, initial status: ${result.status})`);

    // Real delivery status checked 8 sec later
    setTimeout(() => checkMessageStatus(client, result.sid, normalizedPhone), 8000);

    return { success: true, phone: normalizedPhone, sid: result.sid, initialStatus: result.status };
  } catch (err) {
    console.error(`❌ WhatsApp failed to ${normalizedPhone}`);
    console.error('   Error Message:', err.message);
    console.error('   Error Code:', err.code);

    // ✅ BETTER ERROR MESSAGES FOR SANDBOX
    if (err.code === 63015) {
      console.error('   → ERROR 63015: Message outside 24-hour conversation window');
      console.error('   → Reason: Recipient may not be opted in or window expired');
      console.error(getSandboxOptInInstructions());
    } else if (err.code === 63016) {
      console.error('   → ERROR 63016: Message outside 24-hour session window (no template used)');
      console.error('   → Solution: Use message templates or wait for user message');
    } else if (err.code === 21610) {
      console.error('   → ERROR 21610: Recipient has not opted in to sandbox');
      console.error(getSandboxOptInInstructions());
    } else if (err.code === 20003) {
      console.error('   → Authentication error: Check TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN');
    } else if (err.code === 63055) {
      console.error('   → Non-marketing message sent through MM Lite-restricted sender');
    }

    return { 
      success: false, 
      phone: normalizedPhone, 
      error: err.message, 
      code: err.code,
      isSandboxError: [63015, 63016, 21610].includes(err.code),
      sandboxInstructions: getSandboxOptInInstructions()
    };
  }
}

async function checkMessageStatus(client, sid, phoneNumber) {
  try {
    const msg = await client.messages(sid).fetch();
    const statusEmoji = msg.status === 'delivered' ? '📬' : msg.status === 'failed' ? '❌' : '📡';
    console.log(`${statusEmoji} Delivery check for ${phoneNumber} (SID: ${sid}) → status: ${msg.status}${msg.errorCode ? `, errorCode: ${msg.errorCode}` : ''}`);
    
    if (msg.status === 'failed' && msg.errorCode) {
      console.error(`   Error: ${msg.errorMessage || 'Unknown error'}`);
    }
  } catch (err) {
    console.error(`⚠️ Could not fetch delivery status for SID ${sid}:`, err.message);
  }
}

/* ═══════════════════════════════════════════════════════════════
   MASTER NOTIFICATION FUNCTION
   ═══════════════════════════════════════════════════════════════ */
async function sendBookingNotifications(booking) {
  if (!booking) {
    console.error('❌ sendBookingNotifications: Booking object is required');
    return { success: false, error: 'No booking provided' };
  }

  console.log('\n' + '='.repeat(70));
  console.log(`📨 SENDING NOTIFICATIONS FOR BOOKING: ${booking.bookingId || '(new booking)'}`);
  console.log('='.repeat(70) + '\n');

  const results = {
    booking: { id: booking.bookingId, customer: booking.name, email: booking.email, phone: booking.phone },
    notifications: { userEmail: null, userWhatsApp: null, adminEmail: null, adminWhatsApp: null },
    timestamp: new Date().toISOString(),
    sandboxMode: SANDBOX_MODE
  };

  console.log('📧 Sending user confirmation email...');
  results.notifications.userEmail = await sendEmail(
    booking.email,
    booking.name,
    `Booking Confirmed - ${booking.bookingId} | Aman Tour and Travels`,
    buildUserConfirmationEmailHTML(booking)
  );

  console.log('💬 Sending user WhatsApp message...');
  results.notifications.userWhatsApp = await sendWhatsApp(booking.phone, buildUserWhatsAppMessage(booking));

  console.log('📧 Sending admin notification email...');
  const adminEmail = env('ADMIN_EMAIL_NOTIFY') || env('ADMIN_EMAIL');
  results.notifications.adminEmail = await sendEmail(
    adminEmail,
    'Admin',
    `[NEW BOOKING] ${booking.bookingId} - ${booking.name}`,
    buildAdminNotificationEmailHTML(booking)
  );

  console.log('💬 Sending admin WhatsApp message...');
  const adminPhone = env('ADMIN_WHATSAPP') || env('ADMIN_PHONE');
  results.notifications.adminWhatsApp = await sendWhatsApp(adminPhone, buildAdminWhatsAppMessage(booking));

  console.log('\n' + '='.repeat(70));
  console.log('📨 NOTIFICATION BATCH SUMMARY');
  console.log('='.repeat(70));
  console.log(`Booking: ${booking.bookingId}`);
  console.log(`User Email:     ${results.notifications.userEmail?.success ? '✅ Sent' : '❌ Failed'}`);
  console.log(`User WhatsApp:  ${results.notifications.userWhatsApp?.success ? '✅ Sent' : '⚠️ ' + (results.notifications.userWhatsApp?.reason || 'Failed')}`);
  console.log(`Admin Email:    ${results.notifications.adminEmail?.success ? '✅ Sent' : '❌ Failed'}`);
  console.log(`Admin WhatsApp: ${results.notifications.adminWhatsApp?.success ? '✅ Sent' : '⚠️ ' + (results.notifications.adminWhatsApp?.reason || 'Failed')}`);
  
  if (SANDBOX_MODE) {
    console.log('\n' + '⚠️ '.repeat(15));
    console.log('SANDBOX MODE ACTIVE - WhatsApp Limitations:');
    console.log('✓ Recipients must opt in first');
    console.log('✓ Messages valid for 24 hours only');
    console.log('✓ Only ' + SANDBOX_TEST_NUMBERS.length + ' test number(s) allowed');
    console.log('⚠️ '.repeat(15));
  }
  console.log('='.repeat(70) + '\n');

  return results;
}

/* ─── BOOKING STATUS-CHANGE EMAIL ─── */
function buildStatusUpdateEmailHTML(booking, status) {
  const bookingDate = formatBookingDate(booking.pickupDate);
  const vehicleInfo = booking.vehicleId
    ? `${booking.vehicleId.name || ''} ${booking.vehicleId.type ? `(${booking.vehicleId.type})` : ''}`.trim()
    : 'TBD';

  const statusMeta = {
    confirmed: { badge: 'BOOKING CONFIRMED', color: '#2e7d32', headline: 'Your Booking is Confirmed! ✅', line: 'Great news your trip has been confirmed by our team. Driver details will be shared with you shortly.' },
    'in-progress': { badge: 'TRIP IN PROGRESS', color: '#6E1F2B', headline: 'Your Trip Has Started 🚗', line: 'Your driver is on the way / your trip is now in progress. Have a safe journey!' },
    completed: { badge: 'TRIP COMPLETED', color: '#6E1F2B', headline: 'Trip Completed 🎉', line: 'We hope you had a great journey with us. Thank you for choosing Aman Tour and Travels!' },
    cancelled: { badge: 'BOOKING CANCELLED', color: '#D32F2F', headline: 'Booking Cancelled ❌', line: 'Your booking has been cancelled. If this was unexpected or you have questions, please reach out to us.' }
  };
  const meta = statusMeta[status] || { badge: 'STATUS UPDATED', color: '#6E1F2B', headline: 'Booking Status Updated', line: `Your booking status has been updated to "${status}".` };

  const rows =
    emailRow('Booking ID', booking.bookingId || 'N/A') +
    emailRow('Pickup', booking.pickupLocation || 'N/A') +
    emailRow('Drop', booking.dropoffLocation || 'N/A') +
    emailRow('Date', bookingDate) +
    emailRow('Vehicle', vehicleInfo) +
    emailRow('Total Fare', `<span style="color:#6E1F2B;font-weight:700;">${formatCurrency(booking.totalPrice)}</span>`) +
    emailRow('Status', `<span style="color:${meta.color};font-weight:700;text-transform:capitalize;">${status}</span>`);

  return emailShell({
    badgeText: meta.badge,
    badgeColor: meta.color,
    headline: meta.headline,
    introLine: meta.line,
    bodyTableRows: rows,
    footerNote: 'For any questions about your trip, feel free to contact our support team.'
  });
}

async function sendBookingStatusEmail(booking, status) {
  if (!booking) {
    console.error('❌ sendBookingStatusEmail: Booking object is required');
    return { success: false, error: 'No booking provided' };
  }

  const subjectMap = {
    confirmed: `Booking Confirmed - ${booking.bookingId} | Aman Tour and Travels`,
    'in-progress': `Trip Started - ${booking.bookingId} | Aman Tour and Travels`,
    completed: `Trip Completed - ${booking.bookingId} | Aman Tour and Travels`,
    cancelled: `Booking Cancelled - ${booking.bookingId} | Aman Tour and Travels`
  };
  const subject = subjectMap[status] || `Booking Update - ${booking.bookingId} | Aman Tour and Travels`;

  console.log(`📧 Sending "${status}" status email to ${booking.email}...`);
  const result = await sendEmail(booking.email, booking.name, subject, buildStatusUpdateEmailHTML(booking, status));
  console.log(result.success ? `✅ Status email sent (${status})` : `❌ Status email failed: ${result.error || result.reason}`);
  return result;
}

module.exports = {
  sendEmail,
  sendWhatsApp,
  sendBookingNotifications,
  sendBookingStatusEmail,
  normalizePhoneNumber,
  buildUserConfirmationEmailHTML,
  buildAdminNotificationEmailHTML,
  buildUserWhatsAppMessage,
  buildAdminWhatsAppMessage,
  isUserOptedIntoSandbox,
  getSandboxOptInInstructions,
  SANDBOX_MODE
};
