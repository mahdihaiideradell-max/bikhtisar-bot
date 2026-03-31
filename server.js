const express = require("express");
const axios = require("axios");
const admin = require("firebase-admin");

const serviceAccount = require("./serviceAccountKey.json");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();
const app = express();
app.use(express.json());

app.get("/", (req, res) => res.send("سيرفر باختصار يعمل بنجاح!"));

app.post("/webhook/whatsapp", async (req, res) => {
  try {
    const payload = req.body;
    if (payload.event_type === "message_received" && payload.data && !payload.data.fromMe) {
      const customerPhone = payload.data.from;
      const incomingMsg = payload.data.body;
      const instanceId = payload.instanceId;

      const docSnap = await db.collection("saas_system").doc("main_database").get();
      const dbData = docSnap.data();
      const tenant = dbData.tenants.find(t => t.keys && t.keys.waInstance === instanceId);

      if (!tenant || !tenant.aiActive) return res.status(200).send("No Action");

      const menuItems = dbData.menus[tenant.id]?.items || [];
      const menuText = menuItems.length > 0 ? menuItems.map(i => `${i.name} (${i.price} د.ع)`).join("، ") : "المنيو غير متوفر حالياً.";

      const systemPrompt = `أنت مساعد مطعم "${tenant.name}". تعليماتك: "${tenant.prompt}". المنيو: ${menuText}. إذا أكد الزبون طلبه، ابدأ ردك بـ [ORDER_CONFIRMED].`;

      const openaiResponse = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: "gpt-3.5-turbo",
          messages: [{ role: "system", content: systemPrompt }, { role: "user", content: incomingMsg }],
        },
        {
          headers: { Authorization: `Bearer ${tenant.keys.openaiKey}`, "Content-Type": "application/json" },
        }
      );

      let aiReply = openaiResponse.data.choices[0].message.content;

      if (aiReply.includes("[ORDER_CONFIRMED]")) {
        aiReply = aiReply.replace("[ORDER_CONFIRMED]", "").trim();
        const kitchenPhone = tenant.settings?.kitchenPhone;
        if (kitchenPhone) {
          await sendWhatsApp(instanceId, tenant.keys.waToken, kitchenPhone + "@c.us", `🔔 طلب جديد من: ${customerPhone}`);
        }
      }

      await sendWhatsApp(instanceId, tenant.keys.waToken, customerPhone, aiReply);
    }
    res.status(200).send("OK");
  } catch (error) {
    res.status(200).send("Error Handled");
  }
});

async function sendWhatsApp(instanceId, token, to, body) {
  const url = `https://api.ultramsg.com/${instanceId}/messages/chat`;
  const data = new URLSearchParams();
  data.append("token", token);
  data.append("to", to);
  data.append("body", body);
  await axios.post(url, data, { headers: { "Content-Type": "application/x-www-form-urlencoded" } });
}

app.listen(process.env.PORT || 3000);
