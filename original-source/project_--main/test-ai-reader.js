require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { GoogleGenAI } = require("@google/genai");

if (!process.env.GEMINI_API_KEY) {
  console.error("❌ ไม่พบ GEMINI_API_KEY ในไฟล์ .env");
  process.exit(1);
}

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const pdfPath = path.join(
  __dirname,
  "sample-data",
  "Project01 - Ex.Packing List2.pdf"
);

async function testAIReader() {
  try {
    console.log("=================================");
    console.log("🤖 PL BRAND SYSTEM - AI READER");
    console.log("=================================");

    if (!fs.existsSync(pdfPath)) {
      throw new Error("ไม่พบไฟล์ Packing List PDF");
    }

    console.log("📄 พบไฟล์ Packing List แล้ว");
    console.log("📤 กำลัง Upload PDF ไปยัง Gemini...");

    // STEP 1: Upload PDF
    const uploadedFile = await ai.files.upload({
      file: pdfPath,
      config: {
        mime_type: "application/pdf",
      },
    });

    console.log("✅ Upload PDF สำเร็จ");
    console.log("🤖 AI กำลังอ่าน Packing List...");
    console.log("⏳ กรุณารอสักครู่...\n");

    // STEP 2: ให้ AI อ่านเอกสาร
    const interaction = await ai.interactions.create({
      model: "gemini-3.8-flash",

      input: [
        {
          type: "text",
          text: `
You are an AI document reader for the PL Brand System.

Read the attached Packing List carefully.

Your job is ONLY to extract data from the Packing List.

DO NOT guess missing information.
DO NOT determine Brand.
DO NOT check BOM.
DO NOT determine Production Model.

Extract:

- SAP PO
- SAP NO
- Description
- Total Qty
- Qty PCS
- Qty CTNS
- N.W.
- G.W.
- Measurement / Meas.

Description may span multiple lines.
Combine the lines that belong to the same item.

Return ONLY valid JSON in this format:

{
  "document": {
    "sapPO": "",
    "totalQty": "",
    "totalNW": "",
    "totalGW": "",
    "totalMeas": ""
  },

  "items": [
    {
      "sapPO": "",
      "sapNo": "",
      "description": "",
      "qtyPCS": "",
      "qtyCTNS": "",
      "nw": "",
      "gw": "",
      "meas": ""
    }
  ]
}

RULES:

1. Only use information visible in the document.
2. Never invent missing values.
3. SAP numbers must remain strings.
4. Never calculate or modify SAP numbers.
5. If information cannot be found, use "".
6. Never infer values from another item.
7. Do not return Brand.
8. Do not return BOM.
9. Do not return Production Model.
10. Return JSON only.
`,
        },

        {
          type: "document",
          uri: uploadedFile.uri,
          mime_type: uploadedFile.mime_type,
        },
      ],
    });

    console.log("=================================");
    console.log("✅ AI อ่าน Packing List เสร็จแล้ว");
    console.log("=================================\n");

    console.log(interaction.output_text);

  } catch (error) {
    console.error("\n❌ เกิดข้อผิดพลาด");
    console.error(error);
  }
}

testAIReader();