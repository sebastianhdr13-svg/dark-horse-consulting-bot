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
  LOOM_TEAM_ROLE_ID,
  ONBOARDING_SUBMISSIONS_CHANNEL_ID,
  ONBOARDING_FORM_ID,
  TYPEFORM_API_TOKEN,
  EOD_FORM_URL,
  EOD_RESPONSES_CHANNEL_ID,
  EOD_LEADERBOARD_CHANNEL_ID,
  EOD_WEBHOOK_SECRET,
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
      new SlashCommandBuilder()
        .setName('posteodform')
        .setDescription('Posts the End-of-Day Accountability form panel in this channel.')
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
  if (interaction.guildId !== GUILD_ID) return;

  if (interaction.commandName === 'postloomsupport') {
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
    return;
  }

  if (interaction.commandName === 'posteodform') {
    try {
      const embed = new EmbedBuilder()
        .setColor(0xa020f0)
        .setAuthor({ name: 'Dark Horse Consulting' })
        .setTitle('📊 End-of-Day Accountability')
        .addFields(
          {
            name: '📋 What You Need to Do',
            value:
              '1. Fill out the form below, every single day\n' +
              '2. Be honest — this is for you, not for show\n' +
              "3. Your submission posts automatically and updates the leaderboard",
          },
          {
            name: '📝 Submit Your EOD Report Here',
            value: `[>> Click Here to Submit Your EOD Report <<](${EOD_FORM_URL || 'https://example.com'})`,
          }
        )
        .setFooter({ text: `© Dark Horse Consulting, ${new Date().getFullYear()}` });

      await interaction.reply({ embeds: [embed] });
    } catch (err) {
      console.error('Failed to post EOD form embed:', err);
      await interaction.reply({ content: 'Something went wrong posting this, check the logs.', ephemeral: true });
    }
    return;
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

// Turns one Typeform answer into a readable string, regardless of question type.
function formatAnswerValue(answer) {
  switch (answer.type) {
    case 'text':
    case 'email':
    case 'url':
    case 'phone_number':
      return answer[answer.type] || '—';
    case 'number':
      return String(answer.number ?? '—');
    case 'boolean':
      return answer.boolean ? 'Yes' : 'No';
    case 'date':
      return answer.date || '—';
    case 'choice':
      return answer.choice?.label || answer.choice?.other || '—';
    case 'choices':
      return answer.choices?.labels?.join(', ') || '—';
    case 'file_url':
      return answer.file_url || '—';
    default:
      return JSON.stringify(answer[answer.type] ?? answer) || '—';
  }
}

// Builds an ordered list of { question, answer } pairs using Typeform's field
// definitions (titles) matched up to each answer by field id.
function extractAllAnswers(formResponse) {
  const fieldTitles = {};
  (formResponse?.definition?.fields || []).forEach((field) => {
    fieldTitles[field.id] = field.title;
  });

  return (formResponse?.answers || []).map((answer) => ({
    question: fieldTitles[answer.field?.id] || answer.field?.ref || 'Question',
    answer: formatAnswerValue(answer),
  }));
}

const app = express();
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

// Assigns the Client role (if a Discord ID is present) and posts the answers
// embed for one onboarding submission. Used by both the live webhook and the
// periodic catch-up scan, so both paths behave identically.
async function processOnboardingSubmission(formResponse) {
  const answers = formResponse?.answers || [];
  const discordId = extractDiscordId(answers);

  if (discordId) {
    try {
      const guild = await client.guilds.fetch(GUILD_ID);
      const member = await guild.members.fetch(discordId);
      await member.roles.add(CLIENT_ROLE_ID, 'Onboarding form submitted');
      console.log(`Assigned Client role to ${member.user.tag} via Typeform.`);
    } catch (err) {
      console.error(`Failed to assign role for Discord ID ${discordId}:`, err);
    }
  }

  if (!ONBOARDING_SUBMISSIONS_CHANNEL_ID) return false;

  try {
    const qaList = extractAllAnswers(formResponse);
    const channel = await client.channels.fetch(ONBOARDING_SUBMISSIONS_CHANNEL_ID);

    const embed = new EmbedBuilder()
      .setColor(0xa020f0)
      .setTitle('📝 New Onboarding Submission')
      .addFields(
        qaList.slice(0, 25).map((qa) => ({
          name: qa.question.slice(0, 256),
          value: String(qa.answer).slice(0, 1024) || '—',
        }))
      )
      // Small tracking tag, not a visible label — lets the catch-up job know
      // this submission was already posted, even after a bot restart.
      .setFooter({ text: `ref:${formResponse.token}` });

    const teamMention = LOOM_TEAM_ROLE_ID ? `<@&${LOOM_TEAM_ROLE_ID}>` : '';
    await channel.send({
      content: teamMention,
      embeds: [embed],
      allowedMentions: { roles: LOOM_TEAM_ROLE_ID ? [LOOM_TEAM_ROLE_ID] : [] },
    });
    console.log(`Posted onboarding answers (discordId: ${discordId || 'none'}, ref: ${formResponse.token}).`);
    return true;
  } catch (err) {
    console.error('Failed to post onboarding submission embed:', err);
    return false;
  }
}

// Scans the last ~100 messages in the onboarding channel and pulls out every
// ref:xxxx tag already posted, so the catch-up job knows what NOT to repost.
async function getAlreadyPostedRefs() {
  const refs = new Set();
  if (!ONBOARDING_SUBMISSIONS_CHANNEL_ID) return refs;

  try {
    const channel = await client.channels.fetch(ONBOARDING_SUBMISSIONS_CHANNEL_ID);
    const messages = await channel.messages.fetch({ limit: 100 });
    messages.forEach((msg) => {
      msg.embeds.forEach((embed) => {
        const match = embed.footer?.text?.match(/^ref:(.+)$/);
        if (match) refs.add(match[1]);
      });
    });
  } catch (err) {
    console.error('Failed to scan for already-posted onboarding refs:', err);
  }
  return refs;
}

let cachedOnboardingFormDefinition = null;
async function getOnboardingFormDefinition() {
  if (cachedOnboardingFormDefinition) return cachedOnboardingFormDefinition;
  if (!TYPEFORM_API_TOKEN || !ONBOARDING_FORM_ID) return null;

  const res = await fetch(`https://api.typeform.com/forms/${ONBOARDING_FORM_ID}`, {
    headers: { Authorization: `Bearer ${TYPEFORM_API_TOKEN}` },
  });
  if (!res.ok) {
    console.error('Failed to fetch onboarding form definition:', res.status, await res.text());
    return null;
  }
  const data = await res.json();
  cachedOnboardingFormDefinition = { id: data.id, fields: data.fields };
  return cachedOnboardingFormDefinition;
}

// Runs on a timer. Finds any onboarding submission that never got posted
// (e.g. the bot was asleep when it originally came in) and retries it.
async function catchUpOnboardingSubmissions() {
  if (!TYPEFORM_API_TOKEN || !ONBOARDING_FORM_ID) return; // not configured, skip silently

  try {
    const definition = await getOnboardingFormDefinition();
    if (!definition) return;

    const res = await fetch(
      `https://api.typeform.com/forms/${ONBOARDING_FORM_ID}/responses?page_size=25`,
      { headers: { Authorization: `Bearer ${TYPEFORM_API_TOKEN}` } }
    );
    if (!res.ok) {
      console.error('Failed to fetch onboarding responses:', res.status, await res.text());
      return;
    }
    const data = await res.json();
    const items = data.items || [];

    const alreadyPosted = await getAlreadyPostedRefs();
    let retried = 0;

    for (const item of items) {
      if (alreadyPosted.has(item.token)) continue;

      const formResponse = {
        token: item.token,
        answers: item.answers,
        definition: definition,
      };
      const success = await processOnboardingSubmission(formResponse);
      if (success) retried++;
    }

    if (retried > 0) {
      console.log(`Onboarding catch-up job retried and posted ${retried} submission(s).`);
    }
  } catch (err) {
    console.error('Onboarding catch-up job failed:', err);
  }
}

app.post('/typeform-webhook', async (req, res) => {
  if (!verifyTypeformSignature(req)) {
    console.warn('Rejected Typeform webhook: bad signature.');
    return res.status(401).send('Invalid signature');
  }

  const formResponse = req.body?.form_response;
  await processOnboardingSubmission(formResponse);
  res.status(200).send('OK');
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

    const teamMention = LOOM_TEAM_ROLE_ID ? `<@&${LOOM_TEAM_ROLE_ID}>` : '';
    await channel.send({
      content: teamMention,
      embeds: [embed],
      allowedMentions: { roles: LOOM_TEAM_ROLE_ID ? [LOOM_TEAM_ROLE_ID] : [] },
    });
    console.log(`Posted Loom submission from ${discordName}.`);
    res.status(200).send('OK');
  } catch (err) {
    console.error('Failed to post Loom submission:', err);
    res.status(500).send('Failed to post submission');
  }
});

// --- End-of-Day Accountability webhook: posts each day's answers into the ---
// --- responses channel, and updates a single running leaderboard message ---
// --- in the leaderboard channel, ranked by "Total CC This Month" ---

function verifyEodSecret(req) {
  if (!EOD_WEBHOOK_SECRET) return true;
  return req.headers['x-webhook-secret'] === EOD_WEBHOOK_SECRET;
}

// Finds the bot's own existing leaderboard message (if any) and edits it;
// otherwise posts a fresh one. Keeps exactly one live leaderboard message.
async function updateLeaderboardMessage(leaderboard) {
  if (!EOD_LEADERBOARD_CHANNEL_ID) return;

  const monthLabel = new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });

  const rankLines = leaderboard.length
    ? leaderboard
        .map((entry, i) => {
          const medal = ['🥇', '🥈', '🥉'][i] || `**${i + 1}.**`;
          const amount = Number(entry.total) || 0;
          return `${medal} ${entry.name} — $${amount.toLocaleString()}`;
        })
        .join('\n')
    : 'No submissions yet this month.';

  const embed = new EmbedBuilder()
    .setColor(0xa020f0)
    .setTitle(`🏆 Cash Collected Leaderboard — ${monthLabel}`)
    .setDescription(rankLines)
    .setFooter({ text: 'Updated automatically after every EOD submission' })
    .setTimestamp();

  try {
    const channel = await client.channels.fetch(EOD_LEADERBOARD_CHANNEL_ID);
    const messages = await channel.messages.fetch({ limit: 50 });
    const existing = messages.find(
      (m) => m.author.id === client.user.id && m.embeds[0]?.title?.startsWith('🏆 Cash Collected Leaderboard')
    );

    if (existing) {
      await existing.edit({ embeds: [embed] });
    } else {
      const sent = await channel.send({ embeds: [embed] });
      try {
        await sent.pin();
      } catch (err) {
        console.warn('Could not pin leaderboard message (non-fatal):', err.message);
      }
    }
    console.log('Leaderboard updated.');
  } catch (err) {
    console.error('Failed to update leaderboard message:', err);
  }
}

app.post('/eod-webhook', async (req, res) => {
  if (!verifyEodSecret(req)) {
    console.warn('Rejected EOD webhook: bad secret.');
    return res.status(401).send('Invalid secret');
  }

  const { qa, leaderboard } = req.body || {};

  if (EOD_RESPONSES_CHANNEL_ID && Array.isArray(qa)) {
    try {
      const channel = await client.channels.fetch(EOD_RESPONSES_CHANNEL_ID);
      const nameField = qa.find((item) => item.question === 'Name');

      const embed = new EmbedBuilder()
        .setColor(0xa020f0)
        .setTitle(`📊 EOD Report — ${nameField ? nameField.answer : 'Unknown'}`)
        .addFields(
          qa.slice(0, 25).map((item) => ({
            name: String(item.question).slice(0, 256),
            value: String(item.answer || '—').slice(0, 1024),
          }))
        )
        .setTimestamp();

      await channel.send({ embeds: [embed] });
      console.log(`Posted EOD report for ${nameField ? nameField.answer : 'unknown'}.`);
    } catch (err) {
      console.error('Failed to post EOD report:', err);
    }
  }

  if (Array.isArray(leaderboard)) {
    await updateLeaderboardMessage(leaderboard);
  }

  res.status(200).send('OK');
});

app.listen(PORT || 3000, () => {
  console.log(`Webhook server listening on port ${PORT || 3000}.`);
});

// Retry safety net for onboarding submissions — runs every 10 minutes.
setInterval(catchUpOnboardingSubmissions, 10 * 60 * 1000);

client.login(DISCORD_TOKEN);
