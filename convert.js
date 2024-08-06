const fs = require("fs");
const readline = require("readline");
const Path = require("path");
 
const rpath = (...paths) => Path.resolve(__dirname, ...paths);
const guildPath = (gid = "DC") => rpath(DUMP_PATH, gid);
const dumpPath = (gid, cid) => rpath(guildPath(gid), cid + ".dump");

const getEnv = (key, def) => process.env[key] ?? def;
const getEnvArray = key => (process.env[key] ?? "").split("\n").map(it => it.trim()).filter(it => it);

const isDir = path => fs.lstatSync(path).isDirectory();
const isDump = path => path.endsWith(".dump");
const sliceDump = path => path.slice(0, -5);

const sliceFileName = fileName => fileName.slice(-100);

const padStart = n => n.toString().padStart(2, "0");

const getReadableDate = ms => {
  const date = new Date(ms);

  const day = date.getDate();
  const month = MONTHS[date.getMonth()];
  const year = date.getFullYear();
  const hours = date.getHours();
  const minutes = date.getMinutes();

  return `${padStart(hours)}:${padStart(minutes)}, ${month} ${day}, ${year}`;
}; 

const messageToText = (m, {deletedMessages, members, channels}) => {
  const name =  m.author.globalName || m.author.username;
  const channel = m.channel.name;

  const attachments = m.attachments
    .map(a => `${m.guild?.id || "DC"}/attachments/${a.id}.${sliceFileName(a.name)}`)
    .join("\n");
  
  const deleted = deletedMessages.has(m.id) ? " (deleted)" : "";
  const edited = m.editedTimestamp ? " (edited)" : "";
  const reply = m.reference ? " Reply to: " + m.reference.messageId : "";
  const date = getReadableDate(m.editedTimestamp || m.createdTimestamp);
  const content = m.content
                    ?.replace(/<@(\d+)>/g, (_, p1) => "<@" + members[p1] + ">")
                     .replace(/<@!(\d+)>/g, (_, p1) => "<@!" + members[p1] + ">")
                     .replace(/<#(\d+)>/g, (_, p1) => "<#" + channels[p1] + ">");

  if (m.type === 7 || m.type === "GUILD_MEMBER_JOIN")
    return `#${channel} (${date})\n${name} Joined`;
  if (m.type === 19 || m.type === 0 || m.type === "DEFAULT" || m.type === "REPLY")
    return `@${name} #${channel || "DC"} (${date}) $${m.id}${reply}${edited}${deleted}${content && "\n" + content}${attachments && "\nAttachments:\n" + attachments}`;
  return `Unhandled message type: ${m.type}. ${JSON.stringify(m)}`;
};

const getUniqueMessages = messages => {
  const ids = new Set();

  return messages.filter(m => {
    if (m.action) return true;

    if (!ids.has(m.id)) {
      ids.add(m.id);
      return true;
    }

    return false;
  });
};

const readDump = dumpFilePath =>
  new Promise(resolve => {
    const messages = [];

    const stream = readline.createInterface({input: fs.createReadStream(dumpFilePath)});
    stream.on("close", () => resolve(messages));
    stream.on("line", line => {
      if (!line.length) return;

      const m = JSON.parse(line);

      if (m.action === "delete") METADATA.deletedMessages.add(m.id);
      METADATA.channels[m.channel.id] = m.channel.name;
      METADATA.guilds[m.guild?.id || "DC"] = m.guild?.name || "DC";
      METADATA.members[m.author.id] = m.author.globalName || m.author.username;

      if (FILTER_MEMBERS.length ? FILTER_MEMBERS.includes(m.author.id) : true) 
        messages.push(m);
    });
  });

const FILTER_GUILDS = getEnvArray("FILTER_GUILDS");
const EXCLUDE_GUILDS = getEnvArray("EXCLUDE_GUILDS");
const FILTER_CHANNELS = getEnvArray("FILTER_CHANNELS");
const FILTER_MEMBERS = getEnvArray("FILTER_MEMBERS");

const OUTPUT_FILE = getEnv("OUTPUT_FILE", "dump.txt");
const DUMP_PATH = getEnv("DUMP_PATH", "data");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const METADATA = {
  channels: {},
  guilds: {},
  members: {},
  deletedMessages: new Set()
};

const guilds = fs.readdirSync(DUMP_PATH)
  .filter(gid => isDir(guildPath(gid)))
  .map(gid => ({
      id: gid,
      channels: fs.readdirSync(guildPath(gid))
                  .filter(isDump)
                  .map(sliceDump)
                  .filter(cid => FILTER_CHANNELS.length ? FILTER_CHANNELS.includes(cid) : true)
  }))
  .filter(g => !EXCLUDE_GUILDS.includes(g.id))
  .filter(g => FILTER_GUILDS.length ? FILTER_GUILDS.includes(g.id) : true);

(async () => {
  console.time("Read dump");
  const readPromises = guilds
    .map(g => g.channels.map(cid => dumpPath(g.id, cid)))
    .flat(1)
    .map(readDump);
  
  const messages = await Promise.all(readPromises).then(it => it.flat(1));
  console.timeEnd("Read dump");

  console.time("Remove duplicates");
  const uniqueMessages = getUniqueMessages(messages);
  console.timeEnd("Remove duplicates");

  console.time("Sort");
  uniqueMessages.sort((m1, m2) => (m1.editedTimestamp || m1.createdTimestamp) - (m2.editedTimestamp || m2.createdTimestamp));
  console.timeEnd("Sort");

  console.time("Write");
  const writeStream = fs.createWriteStream(OUTPUT_FILE);

  uniqueMessages
    .filter(m => m.action !== "delete")
    .forEach((m, i, a) => {
      const text = messageToText(m, METADATA);

      if (!text?.length) return;

      writeStream.write(text + (i === a.length - 1 ? "" : "\n\n"));
    });

  writeStream.on("close", () => console.timeEnd("Write"));
  writeStream.close();
})();
