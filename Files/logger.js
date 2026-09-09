const rfs = require("rotating-file-stream");
const fs = require("fs");
const path = require("path");

// Thư mục log tùy chỉnh
const projectRoot = path.resolve(__dirname, "..");
const logDirectory = path.join(projectRoot, "LogFiles", "Log");
// hoặc
// const logDirectory = "/data/logs"; // Linux

// Tạo thư mục nếu chưa có
if (!fs.existsSync(logDirectory)) {
  fs.mkdirSync(logDirectory, { recursive: true });
}

// Hàm đặt tên file theo ngày
const generator = (time, index) => {
  const d = time || new Date(); // nếu time chưa có, dùng ngày hiện tại
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  const basename = `${day}-${month}-${year}`;
  if (index){
	return `${basename}.${index}.log.gz`;
}
else{
	return `${basename}.log`;
}
 
};

// Tạo stream
const logStream = rfs.createStream(generator, {
  size: "5M", // Khi file đạt 5MB thì rotate
  //interval: "1d", // Mỗi ngày rotate (bạn có thể bỏ nếu chỉ muốn theo size)
  compress: "gzip", // Nén file cũ
  path: logDirectory,
});

// Hàm ghi log
module.exports.writeLog = (message) => {
  const now = new Date();
  const vnTime = new Date(
    now.toLocaleString('en-US', {
      timeZone: 'Asia/Ho_Chi_Minh'
    })
  );
  const time =
    `${vnTime.getDate()}/${vnTime.getMonth() + 1}/${vnTime.getFullYear()} ` +
    `${String(vnTime.getHours()).padStart(2, '0')}:` +
    `${String(vnTime.getMinutes()).padStart(2, '0')}:` +
    `${String(vnTime.getSeconds()).padStart(2, '0')}`;

  const line = `[${time}] ${message}\n`;
  logStream.write(line);
};
