# Dark Horse Client Bot

Watches the server for the **Client** role being assigned to a member. The moment it is, the bot creates a private text channel for them under the "Private 1 on 1's" category — visible only to them and your staff role(s).

## 1. Create the bot

1. Go to https://discord.com/developers/applications → **New Application**.
2. **Bot** tab → **Reset Token**, copy it (this is `DISCORD_TOKEN`).
3. Same **Bot** tab → under **Privileged Gateway Intents**, enable **Server Members Intent**. (Required — the bot won't see role changes without it.)
4. **OAuth2 → URL Generator**:
   - Scopes: `bot`
   - Bot Permissions: `Manage Channels`, `View Channels`, `Send Messages`
   - Open the generated URL, invite it to **Dark Horse Consulting**.

## 2. Get the IDs you need

Turn on Developer Mode first: Discord → Settings → **Advanced** → Developer Mode.

- `GUILD_ID` — right-click the server icon → Copy Server ID
- `CLIENT_ROLE_ID` — Server Settings → Roles → right-click your "Client" role → Copy Role ID
- `PRIVATE_CATEGORY_ID` — right-click the "Private 1 on 1's" category → Copy Category ID
- `STAFF_ROLE_IDS` — right-click each staff/admin role → Copy Role ID (comma-separate if more than one)

Make sure the bot's own role in Server Settings → Roles is positioned **above** the Client role and staff role(s), and that it has access to the "Private 1 on 1's" category (category permissions are usually inherited automatically).

## 3. Configure

Copy `.env.example` to `.env` and fill in the values above. Don't commit `.env`.

## 4. Deploy to Render

1. Push this folder to a GitHub repo.
2. Render dashboard → **New → Background Worker** (not a Web Service — this bot doesn't listen on a port).
3. Connect the repo.
4. Build command: `npm install`
5. Start command: `npm start`
6. Add each variable from `.env.example` under **Environment**.
7. Deploy. Check the logs for `Logged in as ...` — that confirms it's live.

## 5. Test it

Assign the Client role to a test account in the server. Within a second or two a channel named `{username}-private` should appear under "Private 1 on 1's," with a welcome message tagging them. Re-running the role assignment on someone who already has a channel won't create a duplicate.

## Onboarding form → automatic role, no Zapier

The bot runs its own webhook endpoint at `/typeform-webhook`, so Typeform can call it directly.

1. **In your Typeform**, add a field asking for their Discord User ID, with a short instruction: "Enable Developer Mode in Discord Settings → Advanced, then right-click your profile picture and Copy User ID." Click that field → open its settings and set its **Field ID/ref** to `discord_id` (this is how the bot finds the right answer).
2. **Before the form**, make sure they've already joined your Discord (put the invite link on the page that sends them to the form) — a role can't be assigned to someone who isn't a member yet.
3. **In Typeform**: Connect → Webhooks → add a new webhook pointing to `https://your-render-url.onrender.com/typeform-webhook`. Typeform will also let you set a **secret** — set the same value as `TYPEFORM_WEBHOOK_SECRET` in your `.env` for signature verification (optional but recommended).
4. Set `GENERAL_CHANNEL_ID` in `.env` to your #general-chat channel ID if you want the "welcome so-and-so" post there too.
5. On submission: the bot assigns the Client role → that role change triggers the existing private-channel logic → the private channel gets the welcome message → #general-chat gets the announcement. All in one hop, no Zapier or Make involved.

Note: this webhook needs a public URL, so this part of the bot has to be hosted somewhere reachable from the internet (Render, a VPS, etc.) — it can't run purely on your local machine unless you use a tunneling tool like ngrok.

## Notes

- Channel names are auto-sanitized to Discord's allowed characters (lowercase letters, numbers, hyphens).
- If you ever want to also trigger off a different event (e.g. a Whop/GHL purchase webhook instead of a manual role assignment), that's a separate integration — this bot only reacts to the role itself, so as long as whatever assigns the Client role does so reliably, this stays in sync.
