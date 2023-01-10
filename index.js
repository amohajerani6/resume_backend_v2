var express = require("express")
const {
  uploadFile,
  getFileStream,
  deleteFileS3,
  downloadFile,
} = require("./s3")
const requestIp = require("request-ip")
const request = require("request")
var app = express()
require("dotenv").config()
const cors = require("cors")
const mongoose = require("mongoose")
const mongoModelPages = require("./mongoModelPages")
const mongoModelTraffic = require("./mongoModelTraffic")
const { expressjwt: jwt } = require("express-jwt")
var jwks = require("jwks-rsa")
app.use(cors({ origin: "*" }))
var port = process.env.PORT || 3002
const multer = require("multer")
const dbLink = process.env.dbLink
mongoose.connect(dbLink + "/resume?retryWrites=true&w=majority", {
  useNewUrlParser: true,
})
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "./uploads")
  },
  filename: function (req, file, cb) {
    cb(null, "doc.pdf")
  },
})

const upload = multer({ storage: storage })

var jwtCheck = jwt({
  secret: jwks.expressJwtSecret({
    cache: true,
    rateLimit: true,
    jwksRequestsPerMinute: 5,
    jwksUri: "https://dev-xy0rbu4evnjwlphn.us.auth0.com/.well-known/jwks.json",
  }),
  audience: "http://localhost:3001",
  issuer: "https://dev-xy0rbu4evnjwlphn.us.auth0.com/",
  algorithms: ["RS256"],
})

app.post(
  "/create-page",
  jwtCheck,
  upload.single("file"),
  async function (req, res) {
    var username = req.auth.sub
    let page = req.body.page
    var record = await mongoModelPages.findOne({
      page: page,
    })
    if (!record || record.username == username) {
      //  move the file to s3
      await uploadFile("./uploads/doc.pdf", page + ".pdf")
      // update mongodb
      await mongoModelPages.find({ page: page }).remove().exec()
      var newPage = new mongoModelPages({
        page: page,
        username: username,
      })
      await newPage.save()
      res.send({ created: true })
    } else {
      res.send("page exists and it is not yours")
    }
  }
)

app.get("/pages", jwtCheck, async function (req, res) {
  try {
    var queryResults = await mongoModelPages.find({ username: req.auth.sub })
    res.send(JSON.stringify(queryResults))
  } catch (err) {
    console.log(err)
  }
})

app.get("/", function (req, res) {
  console.log("Received request")
  res.send("The API is working")
})

app.delete("/dash/:page", jwtCheck, async function (req, res) {
  let page = req.params.page
  var record = await mongoModelPages.findOne({
    page: page,
  })

  if (!record || record.username == req.auth.sub) {
    // remove file from S3
    await deleteFileS3(page)
    await mongoModelPages.find({ page: page }).remove().exec()

    res.send({ deleted: true })
  } else {
    res.send("page exists and it is not yours")
  }
})

const getTraffic = async function (page) {
  var traffic = await mongoModelTraffic.find({
    page: page,
  })
  if (!traffic) {
    return ""
  } else {
    return traffic
  }
}

app.get("/dash/:page", jwtCheck, async function (req, res) {
  let page = req.params.page
  var record = await mongoModelPages.findOne({
    page: page,
  })
  if (!record) {
    res.send("This page does not exist")
  } else if (record.username !== req.auth.sub) {
    res.send("You are not authorized to see this page")
  } else {
    // Get the traffic info
    var traffic = await getTraffic(page)
    var json = JSON.stringify({
      page: record["page"],
      username: record["username"],
      traffic: traffic,
    })
    res.send(json)
  }
})

app.get("/view/:page", async function (req, res) {
  let page = req.params.page
  var ip = req.clientIp
  console.log("ip ", ip)
  request("http://ip-api.com/json/" + ip, { json: true }, (err, res, body) => {
    if (err) {
      return console.log(err)
    }
    body["page"] = page
    body["ts"] = Date.now()
    body["userAgent"] = req.headers["user-agent"].replace("Mozilla/5.0 ", "")
    var newTraffic = new mongoModelTraffic(body)
    newTraffic.save()
  })

  //const readStream = getFileStream(page) // Pipe the file directly to the client
  //readStream.pipe(res)
  const filePath = __dirname + "/downloads/" + page + ".pdf"
  await downloadFile(filePath, page)
  res.sendFile(filePath)
})

app.listen(3001, function () {
  console.log({ msg: "Listening on port 3001..." })
})
