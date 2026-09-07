import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { Resend } from "resend";
import dotenv from "dotenv";

dotenv.config();

const resend = new Resend(process.env.RESEND_API_KEY);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Route for Invitations
  app.post("/api/invite", async (req, res) => {
    const { email, enterpriseName, inviterName, appUrl } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    if (!process.env.RESEND_API_KEY) {
      console.error("RESEND_API_KEY is missing from environment variables.");
      return res.status(500).json({ 
        error: "Email service is not configured. Please set RESEND_API_KEY." 
      });
    }

    try {
      // Note: onboarding@resend.dev only works for the account owner's email 
      // until a custom domain is verified in the Resend dashboard.
      const { data, error } = await resend.emails.send({
        from: "onboarding@resend.dev",
        to: [email],
        subject: `Invitation: Join ${enterpriseName}`,
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
            <h2 style="color: #FF6321; margin-top: 0;">Mend</h2>
            <p>Hello,</p>
            <p><strong>${inviterName}</strong> has invited you to join the <strong>${enterpriseName}</strong> workspace.</p>
            <p>Click the button below to accept your invitation and set up your account:</p>
            <div style="margin: 32px 0;">
              <a href="${appUrl}" style="background-color: #000; color: #fff; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">Accept Invitation</a>
            </div>
            <p style="color: #666; font-size: 13px; line-height: 1.5;">
              <strong>Security Note:</strong> You will be asked to verify your email address after registering to ensure your account is secure.
            </p>
            <hr style="border: 0; border-top: 1px solid #eee; margin: 24px 0;" />
            <p style="color: #999; font-size: 10px; text-transform: uppercase; letter-spacing: 1px;">Powered by Mend</p>
          </div>
        `,
      });

      if (error) {
        console.error("Resend API Error:", JSON.stringify(error, null, 2));
        return res.status(400).json({ 
          error: "Email delivery failed. This usually happens if the domain is not verified in Resend.",
          details: error 
        });
      }

      res.json({ success: true, data });
    } catch (err) {
      console.error("Server Exception:", err);
      res.status(500).json({ error: "Internal server error during email dispatch" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
