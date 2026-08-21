import { jsPDF } from "jspdf";
import nodemailer from "nodemailer";

const API_KEY = process.env.FIREBASE_API_KEY || "AIzaSyD8S_dRHVNlmUnRV-AfOXocqR0EoPUh8k4";
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "vdiyagohilcharitable";

const AUTH_URL = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`;
const FIRESTORE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/registrations?pageSize=1000`;

const FIREBASE_AUTH_EMAIL = process.env.FIREBASE_AUTH_EMAIL || process.env.ADMIN_EMAIL || process.env.SMTP_USER || "pradeepparmar902@gmail.com";
const FIREBASE_AUTH_PASSWORD = process.env.FIREBASE_AUTH_PASSWORD || process.env.ADMIN_PASSWORD;

const SENDER_EMAIL = process.env.SMTP_USER || "pradeepparmar902@gmail.com";
const SENDER_PASS = process.env.SMTP_PASS; // Gmail App Password
const RECIPIENTS = process.env.RECIPIENT_EMAILS || "pradeepparmar902@gmail.com, makharishk@gmail.com, 89night@gmail.com";

async function getAuthToken() {
  const email = (FIREBASE_AUTH_EMAIL || "").trim();
  const password = (FIREBASE_AUTH_PASSWORD || "").trim();

  if (!password) {
    console.warn("⚠️ FIREBASE_AUTH_PASSWORD not set. Trying unauthenticated request...");
    return null;
  }
  try {
    const maskedEmail = email.replace(/(?<=.).(?=.*@)/g, "*");
    console.log(`Authenticating with Firebase Auth as ${maskedEmail}...`);
    const res = await fetch(AUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: email,
        password: password,
        returnSecureToken: true
      })
    });
    const data = await res.json();
    if (data.error) {
      console.warn("Firebase authentication error:", data.error.message);
      return null;
    }
    console.log("✅ Authenticated successfully with Firebase!");
    return data.idToken;
  } catch (err) {
    console.warn("Authentication request failed:", err.message);
    return null;
  }
}

async function fetchRegistrations() {
  console.log("Fetching registrations from Firestore...");
  const idToken = await getAuthToken();
  const headers = {};
  if (idToken) {
    headers["Authorization"] = `Bearer ${idToken}`;
  }

  const res = await fetch(FIRESTORE_URL, { headers });
  if (!res.ok) {
    throw new Error(`Firestore fetch failed (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  if (!data.documents) return [];

  return data.documents.map(doc => {
    try {
      const parsed = JSON.parse(doc.fields.data.stringValue);
      let flatData = parsed.formData ? { ...parsed, ...parsed.formData } : parsed;
      delete flatData.formData;
      if (!flatData.eventName && flatData.eventTitle) flatData.eventName = flatData.eventTitle;
      const submittedAt = doc.fields.submittedAt?.timestampValue;
      return { id: doc.name.split("/").pop(), ...flatData, _submittedAt: submittedAt };
    } catch (e) {
      return null;
    }
  }).filter(Boolean);
}

function computePivotData(registrations) {
  const active = registrations.filter(r => !r.deleted && !r.isGlobalGuest && !r.isSpecialGuest);

  const groupsMap = new Map();
  let grandApproved = 0;
  let grandPending = 0;
  let grandRejected = 0;
  let grandTotal = 0;

  active.forEach(r => {
    const vibhag = String(r["Vibhag"] || r["vibhag"] || "Unspecified").trim();
    const stream = String(r["Stream"] || r["stream"] || "General").trim();
    const key = `${vibhag} || ${stream}`;

    if (!groupsMap.has(key)) {
      groupsMap.set(key, { vibhag, stream, approved: 0, pending: 0, rejected: 0, total: 0 });
    }

    const item = groupsMap.get(key);
    const status = String(r.Status || r.status || "Pending").trim();
    if (status === "Approved") {
      item.approved++;
      grandApproved++;
    } else if (status === "Disapproved" || status === "Rejected") {
      item.rejected++;
      grandRejected++;
    } else {
      item.pending++;
      grandPending++;
    }
    item.total++;
    grandTotal++;
  });

  const rows = Array.from(groupsMap.values());
  rows.sort((a, b) => {
    const comp = a.vibhag.localeCompare(b.vibhag);
    return comp !== 0 ? comp : a.stream.localeCompare(b.stream);
  });

  return {
    rows,
    totals: {
      approved: grandApproved,
      pending: grandPending,
      rejected: grandRejected,
      total: grandTotal
    }
  };
}

function generatePDF(pivotData) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.width;
  const pageHeight = doc.internal.pageSize.height;
  const margin = 12;
  const contentWidth = pageWidth - (margin * 2);

  // Header Banner
  doc.setFillColor(30, 41, 59);
  doc.rect(0, 0, pageWidth, 22, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(255, 255, 255);
  doc.text("MUMBAI MEGHWAL PANCHAYAT & VIDYA GOHIL CHARITABLE TRUST", pageWidth / 2, 9, { align: "center" });

  doc.setFontSize(8.5);
  doc.setFont("helvetica", "normal");
  doc.text("DAILY REGISTRATION PIVOT COUNT SUMMARY REPORT", pageWidth / 2, 16, { align: "center" });

  let yPos = 28;
  doc.setFontSize(8.5);
  doc.setTextColor(51, 65, 85);
  doc.setFont("helvetica", "bold");

  const todayStr = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  doc.text(`Report Date: ${todayStr}  |  Grouping: Vibhag + Stream  |  Total Entries: ${pivotData.totals.total}`, margin, yPos);

  yPos += 5;
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.4);
  doc.line(margin, yPos, pageWidth - margin, yPos);

  yPos += 5;

  const vibhagWidth = 52;
  const streamWidth = 44;
  const statColWidth = 22;
  const rowHeight = 7.5;
  const headerHeight = 8.5;

  const drawTableHeader = (currentY) => {
    doc.setFillColor(51, 65, 85);
    doc.rect(margin, currentY, contentWidth, headerHeight, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(255, 255, 255);

    doc.text("Vibhag", margin + 2, currentY + 5.5);
    doc.text("Stream", margin + vibhagWidth + 2, currentY + 5.5);
    doc.text("Approved", margin + vibhagWidth + streamWidth + 2, currentY + 5.5);
    doc.text("Pending", margin + vibhagWidth + streamWidth + statColWidth + 2, currentY + 5.5);
    doc.text("Rejected", margin + vibhagWidth + streamWidth + (statColWidth * 2) + 2, currentY + 5.5);
    doc.text("Total", margin + vibhagWidth + streamWidth + (statColWidth * 3) + 2, currentY + 5.5);

    return currentY + headerHeight;
  };

  yPos = drawTableHeader(yPos);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);

  pivotData.rows.forEach((r, rIdx) => {
    if (yPos + rowHeight > pageHeight - 14) {
      doc.addPage();
      yPos = 12;
      yPos = drawTableHeader(yPos);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
    }

    if (rIdx % 2 === 1) {
      doc.setFillColor(248, 250, 252);
      doc.rect(margin, yPos, contentWidth, rowHeight, "F");
    }

    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.15);
    doc.rect(margin, yPos, contentWidth, rowHeight, "S");

    doc.setTextColor(30, 41, 59);

    const vText = doc.splitTextToSize(r.vibhag, vibhagWidth - 3)[0] || r.vibhag;
    const sText = doc.splitTextToSize(r.stream, streamWidth - 3)[0] || r.stream;

    doc.text(vText, margin + 2, yPos + 5);
    doc.text(sText, margin + vibhagWidth + 2, yPos + 5);
    doc.text(String(r.approved), margin + vibhagWidth + streamWidth + 2, yPos + 5);
    doc.text(String(r.pending), margin + vibhagWidth + streamWidth + statColWidth + 2, yPos + 5);
    doc.text(String(r.rejected), margin + vibhagWidth + streamWidth + (statColWidth * 2) + 2, yPos + 5);
    doc.text(String(r.total), margin + vibhagWidth + streamWidth + (statColWidth * 3) + 2, yPos + 5);

    yPos += rowHeight;
  });

  // Grand Totals Row
  if (yPos + rowHeight > pageHeight - 14) {
    doc.addPage();
    yPos = 12;
  }
  doc.setFillColor(30, 41, 59);
  doc.rect(margin, yPos, contentWidth, rowHeight, "F");
  doc.setFont("helvetica", "bold");
  doc.setTextColor(255, 255, 255);
  doc.text("GRAND TOTAL SUMMARY", margin + 2, yPos + 5);

  doc.text(String(pivotData.totals.approved), margin + vibhagWidth + streamWidth + 2, yPos + 5);
  doc.text(String(pivotData.totals.pending), margin + vibhagWidth + streamWidth + statColWidth + 2, yPos + 5);
  doc.text(String(pivotData.totals.rejected), margin + vibhagWidth + streamWidth + (statColWidth * 2) + 2, yPos + 5);
  doc.text(String(pivotData.totals.total), margin + vibhagWidth + streamWidth + (statColWidth * 3) + 2, yPos + 5);

  // Page numbering
  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184);
    doc.text(`Page ${i} of ${totalPages}  |  Mumbai Meghwal Panchayat & Vidya Gohil Trust Portal`, pageWidth / 2, pageHeight - 5, { align: "center" });
  }

  return Buffer.from(doc.output("arraybuffer"));
}

async function sendEmailWithPDF(pdfBuffer, pivotData) {
  if (!SENDER_PASS) {
    console.warn("⚠️ SMTP_PASS is not set in environment. PDF was generated but email could not be sent.");
    return;
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: SENDER_EMAIL,
      pass: SENDER_PASS
    }
  });

  const todayStr = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const filename = `Daily_Pivot_Summary_Report_${todayStr.replace(/\s+/g, "_")}.pdf`;

  const mailOptions = {
    from: `"MMP & Vidya Gohil Trust" <${SENDER_EMAIL}>`,
    to: RECIPIENTS,
    subject: `📊 Daily Registration Summary Report - ${todayStr}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b; line-height: 1.6;">
        <div style="background: #1e293b; color: white; padding: 18px 24px; border-radius: 8px 8px 0 0; text-align: center;">
          <h2 style="margin: 0; font-size: 16px;">Mumbai Meghwal Panchayat & Vidya Gohil Trust</h2>
          <p style="margin: 4px 0 0 0; font-size: 13px; color: #94a3b8;">Daily Automated Registration Summary Report</p>
        </div>

        <div style="padding: 24px; background: #ffffff; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px;">
          <p style="margin-top: 0;">Respected Committee Members,</p>
          <p>Please find attached the daily automated <strong>Pivot Count Summary Report</strong> for event registrations as of <strong>${todayStr}</strong>.</p>
          
          <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin: 20px 0;">
            <div style="background: #f8fafc; border: 1px solid #cbd5e1; padding: 12px; border-radius: 6px; text-align: center;">
              <div style="font-size: 20px; font-weight: bold; color: #0f172a;">${pivotData.totals.total}</div>
              <div style="font-size: 12px; color: #64748b; font-weight: 600;">Total Registrations</div>
            </div>
            <div style="background: #f0fdf4; border: 1px solid #86efac; padding: 12px; border-radius: 6px; text-align: center;">
              <div style="font-size: 20px; font-weight: bold; color: #15803d;">${pivotData.totals.approved}</div>
              <div style="font-size: 12px; color: #166534; font-weight: 600;">Approved</div>
            </div>
            <div style="background: #fffbeb; border: 1px solid #fde68a; padding: 12px; border-radius: 6px; text-align: center;">
              <div style="font-size: 20px; font-weight: bold; color: #b45309;">${pivotData.totals.pending}</div>
              <div style="font-size: 12px; color: #92400e; font-weight: 600;">Pending</div>
            </div>
            <div style="background: #fef2f2; border: 1px solid #fca5a5; padding: 12px; border-radius: 6px; text-align: center;">
              <div style="font-size: 20px; font-weight: bold; color: #b91c1c;">${pivotData.totals.rejected}</div>
              <div style="font-size: 12px; color: #991b1b; font-weight: 600;">Rejected</div>
            </div>
          </div>

          <p style="font-size: 13px; color: #64748b;">
            📎 The complete PDF breakdown by <strong>Vibhag & Stream</strong> is attached to this email.
          </p>

          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
          <p style="font-size: 11px; color: #94a3b8; margin-bottom: 0;">
            This is an automated report generated by the Mumbai Meghwal Panchayat & Vidya Gohil Trust Portal.
          </p>
        </div>
      </div>
    `,
    attachments: [
      {
        filename: filename,
        content: pdfBuffer,
        contentType: "application/pdf"
      }
    ]
  };

  console.log(`Sending email to: ${RECIPIENTS}...`);
  const info = await transporter.sendMail(mailOptions);
  console.log("✅ Email sent successfully! Message ID:", info.messageId);
}

async function main() {
  try {
    const regs = await fetchRegistrations();
    console.log(`Fetched ${regs.length} registrations.`);
    const pivotData = computePivotData(regs);
    console.log(`Computed ${pivotData.rows.length} pivot rows. Total: ${pivotData.totals.total}`);
    const pdfBuffer = generatePDF(pivotData);
    console.log(`Generated PDF (${pdfBuffer.length} bytes).`);
    await sendEmailWithPDF(pdfBuffer, pivotData);
    console.log("🎉 Daily Pivot Report process completed!");
  } catch (err) {
    console.error("❌ Error in daily pivot report:", err);
    process.exit(1);
  }
}

main();
