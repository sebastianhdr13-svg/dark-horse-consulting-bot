require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  ChannelType,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  AttachmentBuilder,
} = require('discord.js');

const {
  DISCORD_TOKEN,
  GUILD_ID,
  CLIENT_ROLE_ID,
  PRIVATE_CATEGORY_ID,
  STAFF_ROLE_IDS,
  CHANNEL_NAME_SUFFIX,
  GENERAL_CHANNEL_ID,
  LOOM_SUBMISSIONS_CHANNEL_ID,
  LOOM_WEBHOOK_SECRET,
  TYPEFORM_WEBHOOK_SECRET,
  PORT,
  LOOM_FORM_URL,
} = process.env;

const REQUIRED_ENV = {
  DISCORD_TOKEN,
  GUILD_ID,
  CLIENT_ROLE_ID,
  PRIVATE_CATEGORY_ID,
};

for (const [key, value] of Object.entries(REQUIRED_ENV)) {
  if (!value) {
    console.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
}

const staffRoleIds = (STAFF_ROLE_IDS || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

const suffix = CHANNEL_NAME_SUFFIX || '-private';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers, // privileged intent — enable in Dev Portal
  ],
  partials: [Partials.GuildMember],
});

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}. Watching guild ${GUILD_ID} for role ${CLIENT_ROLE_ID}.`);

  try {
    const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
    const commands = [
      new SlashCommandBuilder()
        .setName('postloomsupport')
        .setDescription('Posts the 1-1 Loom Support info panel in this channel.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .toJSON(),
    ];
    await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
    console.log('Registered /postloomsupport command.');
  } catch (err) {
    console.error('Failed to register slash commands:', err);
  }

  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const members = await guild.members.fetch();
    const clientMembers = members.filter((m) => m.roles.cache.has(CLIENT_ROLE_ID));

    console.log(`Reconciling ${clientMembers.size} existing member(s) with the Client role...`);
    for (const member of clientMembers.values()) {
      await createPrivateChannel(member);
    }
  } catch (err) {
    console.error('Startup reconciliation failed:', err);
  }
});

// Discord.js sanitization for channel names: lowercase, spaces -> hyphens, strip invalid chars
function toChannelName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 90); // leave room for the suffix within Discord's 100 char limit
}

async function findExistingChannel(guild, baseName) {
  const category = await guild.channels.fetch(PRIVATE_CATEGORY_ID);
  if (!category) return null;
  const channels = await guild.channels.fetch();
  return channels.find(
    (ch) => ch && ch.parentId === PRIVATE_CATEGORY_ID && ch.name === baseName
  );
}

async function createPrivateChannel(member) {
  const guild = member.guild;
  const baseName = toChannelName(member.displayName) + suffix;

  const existing = await findExistingChannel(guild, baseName);
  if (existing) {
    console.log(`Channel ${baseName} already exists for ${member.user.tag}, skipping.`);
    return;
  }

  const permissionOverwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionsBitField.Flags.ViewChannel],
    },
    {
      id: member.id,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.AttachFiles,
        PermissionsBitField.Flags.EmbedLinks,
      ],
    },
    ...staffRoleIds.map((roleId) => ({
      id: roleId,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.ManageMessages,
      ],
    })),
  ];

  try {
    const channel = await guild.channels.create({
      name: baseName,
      type: ChannelType.GuildText,
      parent: PRIVATE_CATEGORY_ID,
      permissionOverwrites,
      reason: `Client role assigned to ${member.user.tag}`,
    });

    const teamMentions = staffRoleIds.map((id) => `<@&${id}>`).join(' ');

    await channel.send({
      content:
        `Yoo <@${member.id}>, welcome to Dark Horse Consulting, we're hyped to have you here.\n\n` +
        `This is a private chat between you and me, feel free to ask any questions about anything, and I'll be happy to help out every step of the way.\n\n` +
        `Here's what to knock out next:\n\n` +
        `1️⃣ Drop an intro in the general chat, let us know who you are and what you're working with.\n` +
        `2️⃣ Join Skool with the link, this is where the modules/information is hosted: [link]\n` +
        `3️⃣ Go through the Start Here section inside Skool, it'll get you oriented fast.\n` +
        `4️⃣ Book your onboarding call through Skool after finishing the Start Here section.\n\n` +
        `Knock these out, and you're locked in. Let's get to work.\n\n` +
        `${teamMentions}`,
      allowedMentions: { parse: ['users'], roles: staffRoleIds },
    });

    console.log(`Created ${channel.name} for ${member.user.tag}.`);

    if (GENERAL_CHANNEL_ID) {
      try {
        const generalChannel = await guild.channels.fetch(GENERAL_CHANNEL_ID);
        if (generalChannel) {
          await generalChannel.send({
            content:
              `@everyone please give a warm welcome to the new legend <@${member.id}>! We're all hyped to have you 🤙 Please introduce yourself and connect with the rest of the legends...\n\n` +
              `1. Drop your Instagram handle\n` +
              `2. Drop your goal(s) for the next 3 months inside the program\n` +
              `3. Let us know more about yourself (anything you'd like)\n\n` +
              `Time to take action and RIP 💰`,
            allowedMentions: { parse: ['everyone', 'users'] },
          });
        }
      } catch (err) {
        console.error('Failed to post general-chat welcome:', err);
      }
    }
  } catch (err) {
    console.error(`Failed to create private channel for ${member.user.tag}:`, err);
  }
}

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'postloomsupport') return;
  if (interaction.guildId !== GUILD_ID) return;

  try {
    const bannerPath = path.join(__dirname, 'assets', 'dark-horse-banner.png');
    const attachment = new AttachmentBuilder(bannerPath, { name: 'dark-horse-banner.png' });

    const embed = new EmbedBuilder()
      .setColor(0xa020f0)
      .setAuthor({ name: 'Dark Horse Consulting' })
      .setTitle('🎥 1-1 Loom Support — How It Works')
      .setDescription(
        `Submit your Loom video and get personalized help solving your bottlenecks. ` +
          `Your response will be delivered in your private 1-on-1 channel.`
      )
      .addFields(
        {
          name: '📋 What You Need to Do',
          value:
            '1. Come prepared with your bottlenecks\n' +
            '2. Record a Loom explaining your issue\n' +
            '3. Submit the form below\n' +
            '4. Get your response Loom within 24 hours',
        },
        {
          name: '🔍 What to Expect',
          value:
            "• I'll watch your Loom and analyze your issue\n" +
            "• I'll walk through exactly how to solve your bottleneck\n" +
            '• Response delivered within **24 hours**\n' +
            "• I'll message you directly in your private 1-on-1 channel",
        },
        {
          name: '🎬 How to Record Your Loom',
          value:
            '1. Go to [Loom.com](https://loom.com)\n' +
            '2. Click **"Start Recording"**\n' +
            '3. Explain your bottleneck clearly\n' +
            '4. Share the link in the form below',
        },
        {
          name: '📩 Submit Your Loom Here',
          value: `[>> Click Here to Submit Your Loom <<](${LOOM_FORM_URL || 'https://example.com'})\nFill out the form with your name, Loom link, and description.`,
        },
        {
          name: '⚡ What Happens Next?',
          value:
            "✅ I'll receive your submission\n" +
            "✅ I'll watch your Loom and review your issue\n" +
            "✅ I'll record a response Loom showing the solution\n" +
            "✅ I'll send the response in your private 1-on-1 channel",
        }
      )
      .setImage('attachment://dark-horse-banner.png')
      .setFooter({ text: `© Dark Horse Consulting, ${new Date().getFullYear()}` });

    await interaction.reply({ embeds: [embed], files: [attachment] });
  } catch (err) {
    console.error('Failed to post loom support embed:', err);
    await interaction.reply({ content: 'Something went wrong posting this, check the logs.', ephemeral: true });
  }
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
  if (newMember.guild.id !== GUILD_ID) return;

  const hadRole = oldMember.roles.cache.has(CLIENT_ROLE_ID);
  const hasRole = newMember.roles.cache.has(CLIENT_ROLE_ID);

  if (!hadRole && hasRole) {
    await createPrivateChannel(newMember);
  }
});

// Handles the invite-link auto-role case: when someone joins via a link that
// assigns a role at join time, Discord creates them as a member WITH the role
// already attached — that's a brand-new member, not a role change on an existing
// one, so guildMemberUpdate never fires for it. This catches that case.
client.on('guildMemberAdd', async (member) => {
  if (member.guild.id !== GUILD_ID) return;

  if (member.roles.cache.has(CLIENT_ROLE_ID)) {
    await createPrivateChannel(member);
  }
});

// --- Typeform webhook: assigns the Client role directly, no Zapier/Make involved ---

function verifyTypeformSignature(req) {
  if (!TYPEFORM_WEBHOOK_SECRET) return true; // verification is optional but recommended
  const signature = req.headers['typeform-signature'];
  if (!signature) return false;
  const hash =
    'sha256=' +
    crypto.createHmac('sha256', TYPEFORM_WEBHOOK_SECRET).update(req.rawBody).digest('base64');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(hash));
}

// Pulls the Discord ID out of the submission. Looks for a field with ref "discord_id"
// first; falls back to any answer that looks like a Discord snowflake ID.
function extractDiscordId(answers) {
  const byRef = answers.find((a) => a.field && a.field.ref === 'discord_id');
  if (byRef) return String(byRef.text ?? byRef.number ?? '').trim();

  const fallback = answers.find((a) => {
    const val = String(a.text ?? a.number ?? '').trim();
    return /^\d{15,25}$/.test(val);
  });
  return fallback ? String(fallback.text ?? fallback.number ?? '').trim() : null;
}

const app = express();
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

app.post('/typeform-webhook', async (req, res) => {
  if (!verifyTypeformSignature(req)) {
    console.warn('Rejected Typeform webhook: bad signature.');
    return res.status(401).send('Invalid signature');
  }

  const answers = req.body?.form_response?.answers || [];
  const discordId = extractDiscordId(answers);

  if (!discordId) {
    console.warn('Typeform submission had no usable Discord ID.');
    return res.status(400).send('No Discord ID found in submission');
  }

  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const member = await guild.members.fetch(discordId);
    await member.roles.add(CLIENT_ROLE_ID, 'Onboarding form submitted');
    console.log(`Assigned Client role to ${member.user.tag} via Typeform.`);
    res.status(200).send('OK');
  } catch (err) {
    console.error(`Failed to assign role for Discord ID ${discordId}:`, err);
    res.status(500).send('Failed to assign role — is this person a server member yet?');
  }
});

app.get('/', (req, res) => res.send('Dark Horse client bot is running.'));

// --- Loom submission webhook: fired by a Google Apps Script trigger on the ---
// --- Loom Submission Form, posts a formatted embed into #loom-submissions ---
app.post('/loom-submission-webhook', async (req, res) => {
  if (LOOM_WEBHOOK_SECRET) {
    const providedSecret = req.headers['x-webhook-secret'];
    if (providedSecret !== LOOM_WEBHOOK_SECRET) {
      console.warn('Rejected Loom submission webhook: bad secret.');
      return res.status(401).send('Invalid secret');
    }
  }

  const { discordName, issue, loomUrl } = req.body || {};

  if (!discordName || !loomUrl) {
    console.warn('Loom submission webhook missing required fields.');
    return res.status(400).send('Missing discordName or loomUrl');
  }

  if (!LOOM_SUBMISSIONS_CHANNEL_ID) {
    console.error('LOOM_SUBMISSIONS_CHANNEL_ID is not set.');
    return res.status(500).send('Server not configured for loom submissions');
  }

  try {
    const channel = await client.channels.fetch(LOOM_SUBMISSIONS_CHANNEL_ID);

    const embed = new EmbedBuilder()
      .setColor(0xa020f0)
      .setTitle('🎬 New Loom Submission')
      .setDescription('**Action Required:** Review and respond within 24 hours')
      .addFields(
        { name: '👤 Discord Name', value: discordName },
        { name: '🎥 Their Loom', value: `[Watch Video](${loomUrl})` },
        { name: '📝 Issue', value: issue || 'Not provided' }
      )
      .setFooter({ text: 'Respond within 24 hours in their private 1-on-1 channel' });

    await channel.send({ embeds: [embed] });
    console.log(`Posted Loom submission from ${discordName}.`);
    res.status(200).send('OK');
  } catch (err) {
    console.error('Failed to post Loom submission:', err);
    res.status(500).send('Failed to post submission');
  }
});

app.listen(PORT || 3000, () => {
  console.log(`Webhook server listening on port ${PORT || 3000}.`);
});

client.login(DISCORD_TOKEN);
