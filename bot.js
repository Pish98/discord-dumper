const Path = require("path");
const fs = require("fs");
const Discord = require("discord.js");
const DiscordSelf = require("discord.js-selfbot-v13");
const readline = require("readline");
const request = require("request");

const COMMANDS = {
  guilds(msg) {
    const lines = CLIENTS
                    .map(bot => bot.guilds.cache)
                    .map(toArray)
                    .flat(1)
                    .map(toArrowText);

    sendByChunks(msg.channel, removeDups(lines));
  },
  channels(msg) {
    const guild = getGuild(getArg(msg, 0));
    if (!guild) return send(msg.channel, "Guild not found");

    const lines = guild.channels.cache
                    .filter(isTextChannel)
                    .map(toArrowText);

    sendByChunks(msg.channel, lines);
  },
  async dump(msg) {
    const arg = getArg(msg, 0, "");

    const ids = arg === "all" ? getGuildsIds() : arg.split(",");

    for (let id of ids) {
      const entity = getGuild(id) || getChannel(id);
      if (!entity) return send(msg.channel, `Guild or channel not found ${id}`);

      const channels = entity.channels?.cache || [entity];

      for (let channel of toArray(channels).filter(isTextChannel))
        await downloadChannel(msg, channel, +getArg(msg, 1));

  	  if (entity.channels?.cache) send(msg.channel,  `Done! ${entity.name}`);
    }
  }
};


const rpath = (...paths) => Path.resolve(__dirname, ...paths);
const guildPath = (gid = "DC") => rpath(DUMP_PATH, gid);
const dumpPath = (gid, cid) => rpath(guildPath(gid), cid + ".dump");
const attachmentsPath = gid => rpath(guildPath(gid), "attachments");
const mkdir = path => fs.existsSync(path) || fs.mkdirSync(path);

const isTextChannel = c => c.type === "GUILD_TEXT" || c.type === 0 || c.type === "DM";

const removeDups = arr => [...new Set(arr)];
const toArrowText = i => `${i.name} -> ${i.id}`;
const toArray = c => [...c.values()];
const sliceFileName = fileName => fileName.slice(-100);

const getArg = (msg, n, def) => msg.content.split(" ")[n + 1] ?? def;
const getEnv = (key, def) => process.env[key] || def;
const getEnvArray = key => (process.env[key] || "").split("\n").map(it => it.trim()).filter(it => it);
const getBot = fn => CLIENTS.find(fn);
const getEntity = fn => getBot(fn) && fn(getBot(fn));
const getGuild = gid => getEntity(bot => bot.guilds.cache.get(gid));
const getChannel = cid => getEntity(bot => bot.channels.cache.get(cid));
const getChannelName = channel => channel.name || channel.recipient.globalName || channel.recipient.username;
const getGuildsIds = () => removeDups(CLIENTS.map(bot => bot.guilds.cache.map(g => g.id)).flat(1));

const send = (sendable, msg) => sendable.send(msg).catch(console.error);
const sendByChunks = (sendable, lines)  => splitByChunks(lines).forEach(chunk => send(sendable, chunk));
const fetchAuthor = () => Promise.resolve(CLIENTS[0].users.cache.get(LOG_USER_ID) || CLIENTS[0].users.fetch(LOG_USER_ID));
const messageHandler = (msg, action, bot) =>
    getBot(bot => bot.channels.cache.has(msg.channel.id)) === bot && downloadMessage(msg, action);

const splitByChunks = lines => 
  lines
    .reduce((acc, value) => {
      if (acc[acc.length - 1].length + value.length >= MAX_MESSAGE_LENGTH) acc.push("");
      acc[acc.length - 1] += "\n" + value;
      return acc;
    }, [""]);

const messagesIdsFromDump = dumpFilePath =>
  new Promise(resolve => {
    const result = new Set();

    if (!fs.existsSync(dumpFilePath)) return resolve(result);

    const stream = readline.createInterface({input: fs.createReadStream(dumpFilePath)});
    stream.on("close", () => resolve(result));
    stream.on("line", line => {
      if (!line.length) return;
      result.add(JSON.parse(line).id);
    });
  });

const messageToJsonString = (m, action) =>
  JSON.stringify({
    action,
    attachments: toArray(m.attachments).map(a => ({
      attachment: a.attachment,
      url: a.url,
      name: a.name,
      id: a.id,
      width: a.width,
      height: a.height
    })),
    channel: {
      id: m.channel?.id,
      name: m.channel?.name
    },
    guild: m.guild && {
      id: m.guild.id,
      name: m.guild.name,
      icon: m.guild.icon,
      ownerId: m.guild.ownerId
    },
    author: {
      id: m.author?.id,
      bot: m.author?.bot,
      username: m.author?.username,
      globalName: m.author?.globalName,
      avatar: m.author?.avatar,
      joinedTimestamp: m.member?.joinedTimestamp,
      nickname: m.member?.nickname
    },
    reference: JSON.parse(JSON.stringify(m.reference)),
    editedTimestamp: m.editedTimestamp,
    pinned: m.pinned,
    type: m.type,
    nonce: m.nonce,
    system: m.system,
    id: m.id,
    content: m.content,
    mentions: JSON.parse(JSON.stringify(m.mentions)),
    createdTimestamp: m.createdTimestamp
  });

const fetchMessages = (channel, lastID, maxAttempts) =>
  maxAttempts > 0 &&
    channel.messages.fetch({
        limit: 100,
        ...(lastID && { before: lastID }),
      }).catch(err => {
        console.error(err);
        return fetchMessages(channel, lastID, maxAttempts - 1);
      });

async function downloadChannel(msg, channel, maxChunks) {
  const messagesIds = await messagesIdsFromDump(dumpPath(channel.guild?.id, channel.id));

  let lastID;
  let i = 0;

	await send(msg.channel, `Downloading #${getChannelName(channel)}`);

  while (true) {
    if (i >= maxChunks && maxChunks)
      return send(msg.channel, `Done! #${getChannelName(channel)}`);

    const fetchedMessages = await fetchMessages(channel, lastID, 5);

	  if (!fetchedMessages)
	  	 return send(msg.channel, `Some error with #${channel.name}`)
    if (fetchedMessages.size === 0)
      return send(msg.channel, `Done! #${getChannelName(channel)}`)

    for (let msg of fetchedMessages.values())
      if (!messagesIds.has(msg.id))
        await downloadMessage(msg);

    lastID = fetchedMessages.lastKey();
    i++;
  }
}

async function downloadMessage(msg, action) {
  mkdir(guildPath(msg.guild?.id));

  for (let attachment of msg.attachments.values())
    await downloadAttachment(attachment, msg.guild?.id).catch(console.error);

  fs.appendFileSync(dumpPath(msg.guild?.id, msg.channel.id), "\n" + messageToJsonString(msg, action));
}

function downloadAttachment({id, name, url}, gid) {
  const apath = attachmentsPath(gid);
  const path = rpath(apath, `${id}.${sliceFileName(name)}`);

  mkdir(apath);

  if (fs.existsSync(path)) return Promise.resolve();

  return new Promise((resolve, reject) => {
    request.get(url)
      .on("error", reject)
      .on("response", resolve)
      .pipe(fs.createWriteStream(path));
  });
}


const DUMP_PATH = getEnv("DUMP_PATH", "data");
const MAX_MESSAGE_LENGTH = +getEnv("MAX_MESSAGE_LENGTH", 2000);
const LOG_USER_ID = getEnv("LOG_USER_ID");
const PREFIX = getEnv("PREFIX", "+");
const USER_TOKENS = getEnvArray("USER_TOKENS");
const BOT_TOKENS = getEnvArray("BOT_TOKENS");

const USER_CLIENTS = USER_TOKENS.map(_ => new DiscordSelf.Client());
const BOT_CLIENTS = BOT_TOKENS.map(_ => new Discord.Client({
    intents: [
        Discord.IntentsBitField.Flags.Guilds,
        Discord.IntentsBitField.Flags.GuildMessages,
        Discord.IntentsBitField.Flags.GuildMembers,
        Discord.IntentsBitField.Flags.MessageContent
    ]
}));
const CLIENTS = [...BOT_CLIENTS, ...USER_CLIENTS];

mkdir(rpath(DUMP_PATH));

for (const bot of CLIENTS) {
  bot.on("ready", () => {
    console.log(`Info: Bot ${bot.user.tag} has been started!`);
    fetchAuthor()
      .then(u => send(u, `Dumper ${bot.user.tag} has been started!`))
      .catch(() => {});
  });

  bot.on("messageDelete", msg => messageHandler(msg, "delete", bot));
  bot.on("messageUpdate", (_, msg) => messageHandler(msg, "edit", bot));
  bot.on("messageCreate", msg => messageHandler(msg, undefined, bot));
}


CLIENTS[0]?.on("messageCreate", async msg => {
  if (msg.author.id !== LOG_USER_ID || !msg.content?.startsWith(PREFIX)) return;

  const cmd = msg.content.slice(PREFIX.length).trim().split(" ")[0];
  if (cmd in COMMANDS) COMMANDS[cmd](msg);
});

USER_CLIENTS.forEach((bot, i) => bot.login(USER_TOKENS[i]));
BOT_CLIENTS.forEach((bot, i) => bot.login(BOT_TOKENS[i]));
