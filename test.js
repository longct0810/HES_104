let logFiles = "";
var fs = require('fs');
var define = require('./define.js');
//var import_online = require('./import.js');
const hexToDecimal = hex => parseInt(hex, 16);
const logger = require('./Files/logger.js');
module.exports.analyser = (data_hex, tenthietbi, idthietbi) => {
    var arr_byte = hexStringToByte(data_hex);
    var arr_data_hex = [];
    for (m = 0; m < arr_byte.length; m) {
        if (arr_byte[m] == 0x68) {
            var idx = m
            var tol_len = arr_byte[idx + 1];
            var _arr = []
            for (n = 0; n < tol_len + 2; n++) {
                _arr[n] = arr_byte[m++];
            }
            var _str = byteToHexString(_arr).replace(/ /g, "");
            arr_data_hex.push(_str);
        }
        else {
            m++;
        }
    }
    var data_json = [];
    var data_write = '\n';
    for (j = 0; j < arr_data_hex.length; j++) {
        var arr_hex = hexString2Array(arr_data_hex[j]);
        var arr_byte = hexStringToByte(arr_data_hex[j]);
        //ASDU
        var type_id = define.getTypeID(arr_byte[6]);
        var dataType = type_id[0]; //loại data type
        var dataLength = type_id[1]; //dộ dài value
        var qdsLength = type_id[2];
        var time = f_DateTime();
        var arr_data = arr_byte.slice(12, arr_byte.length);
        var _lenData = dataLength + 3 + qdsLength; //bo qua byte thong tin thua, chi lay value
        if ((dataType == 'M_SP_NA_1' || dataType == 'M_SP_TA_1' || dataType == 'M_ME_NB_1') && (arr_data.length == (arr_byte.length - 12)) && arr_data.length > 0) {
            var _sq = hex2bin(arr_byte[7]);
            var sq = _sq.substring(0, 1);
            var _item = _sq.substring(1, 8);
            var item_count = parseInt(_item, 2);
            if (sq == '1') {
                if (dataType == 'M_ME_NB_1') {
                    var temp_ioa = [];
                    for (var m = 0; m < 3; m++) { //ioa = 3 byte
                        temp_ioa[m] = arr_data[m];
                    }
                    temp_ioa.reverse();
                    var ioa = parseInt(byteToHexString(temp_ioa).replace(/ /g, ""), 16);
                    var index = 3;
                    for (n = 0; n < item_count; n++) {
                        var id_cambien = ioa + n;
                        var temp_value = [];
                        for (m = 0; m < dataLength; m++) { //data length tùy thuộc loại dữ liệu
                            temp_value[m] = arr_data[index * (n + 1) + m];
                        }
                        var temp_qds = [];
                        for (k = 0; k < qdsLength; k++) { //data length tùy thuộc loại dữ liệu
                            temp_qds[k] = arr_data[index * (n + 1) + m];
                        }
                        temp_value.reverse(); //đảo byte
                        var value = parseInt(byteToHexString(temp_value).replace(/ /g, ""), 16);
                        if ((value & 0x8000) > 0) {
                            value = value - 0x10000;
                        }
                        var item = [tenthietbi, idthietbi, id_cambien, value, time]
                        data_json.push(item);
                        data_write += idthietbi + ';' + id_cambien + ';' + value + ';' + time + '\n';
                    }
                }
                else {
                    var temp_ioa = [];
                    for (var m = 0; m < 3; m++) { //ioa = 3 byte
                        temp_ioa[m] = arr_data[m++];
                    }
                    temp_ioa.reverse();
                    var ioa = parseInt(byteToHexString(temp_ioa).replace(/ /g, ""), 16);
                    for (n = 0; n < item_count; n++) {
                        var id_cambien = ioa + n;
                        var value = arr_data[3 + n];
                        value &= 0x01;
                        var item = [tenthietbi, idthietbi, id_cambien, value, time]
                        data_json.push(item);
                        data_write += idthietbi + ';' + id_cambien + ';' + value + ';' + time + '\n';
                    }
                }
            }
            else {
                for (i = 0; i < arr_data.length; i) {
                    var temp_ioa = [];
                    for (m = 0; m < 3; m++) { //ioa = 3 byte
                        temp_ioa[m] = arr_data[i++];
                    }
                    var temp_value = [];
                    for (n = 0; n < dataLength; n++) { //data length tùy thuộc loại dữ liệu
                        temp_value[n] = arr_data[i++];
                    }
                    var temp_qds = [];
                    for (k = 0; k < qdsLength; k++) { //data length tùy thuộc loại dữ liệu
                        temp_qds[k] = arr_data[i++];
                    }
                    temp_ioa.reverse(); //đảo byte
                    temp_value.reverse(); //đảo byte
                    var ioa = parseInt(byteToHexString(temp_ioa).replace(/ /g, ""), 16);
                    var value = '';
                    var check = byteToHexString(temp_value);
                    if (check.replace(/ /g, "") != 'EEEE') {
                        if (dataType == 'M_ME_NC_1') {
                            value = IEEE_754_convert(temp_value);
                        }
                        else {
                            var value = parseInt(byteToHexString(temp_value).replace(/ /g, ""), 16);
                            if ((value & 0x8000) > 0) {
                                value = value - 0x10000;
                            }
                        }
                    }
                    var id_cambien = ioa;
                    var item = [tenthietbi, idthietbi, id_cambien, value, time]
                    data_json.push(item);
                    data_write += idthietbi + ';' + id_cambien + ';' + value + ';' + time + '\n';
                }
            }
            //var item = { 'data': data_write, 'id': idthietbi, 'hex': arr_data_hex[j] }
            //writeLogFile(item);
        }
        else if ((dataType == 'M_ME_NA_1' || dataType == 'M_ME_NC_1') && (arr_data.length == (arr_byte.length - 12)) && arr_data.length > 0) {
            for (i = 0; i < arr_data.length; i) {
                var temp_ioa = [];
                for (m = 0; m < 3; m++) { //ioa = 3 byte
                    temp_ioa[m] = arr_data[i++];
                }
                var temp_value = [];
                for (n = 0; n < dataLength; n++) { //data length tùy thuộc loại dữ liệu
                    temp_value[n] = arr_data[i++];
                }
                var temp_qds = [];
                for (k = 0; k < qdsLength; k++) { //data length tùy thuộc loại dữ liệu
                    temp_qds[k] = arr_data[i++];
                }
                temp_ioa.reverse(); //đảo byte
                temp_value.reverse(); //đảo byte
                var ioa = parseInt(byteToHexString(temp_ioa).replace(/ /g, ""), 16);
                var value = '';
                var check = byteToHexString(temp_value);
                if (check.replace(/ /g, "") != 'EEEE') {
                    if (dataType == 'M_ME_NC_1') {
                        value = IEEE_754_convert(temp_value);
                    }
                    else {
                        var value = parseInt(byteToHexString(temp_value).replace(/ /g, ""), 16);
                        if ((value & 0x8000) > 0) {
                            value = value - 0x10000;
                        }
                    }
                }
                var id_cambien = ioa;
                var item = [tenthietbi, idthietbi, id_cambien, value, time]
                data_json.push(item);
                data_write += idthietbi + ';' + id_cambien + ';' + value + ';' + time + '\n';
            }
            //var item = { 'data': data_write, 'id': idthietbi, 'hex': arr_data_hex[j] }
            //writeLogFile(item);
            //import_online.updateOnline(idthietbi);
        }
    }
    //logger.writeLog(data_write);
    console.log(data_write)
    //var item = { 'data': data_write, 'id': idthietbi, 'hex': arr_data_hex[j] }
    //writeLogFile(item);
    const message = {
        type: "DATA",
        Data: data_json
    };
    return message;
}
function writeLogFile(data_json) {
    var dir_data = "LogFiles/Data_RTU/";
    if (!fs.existsSync(dir_data)) {
        fs.mkdir(dir_data, function (err) {
            if (err) {
                return 'ERROR';
            } else {
                return 'OK';
            }
        })
    }
    var random = Math.floor(Math.random() * (100 - 1 + 1)) + 1;
    var filepath = dir_data + '/' + data_json.id + "_" + getStringDate_ghifile() + '_' + random + '.txt';
    try {
        fs.writeFile(filepath, data_json.data, 'utf8', function (err) {
            if (err) {
                console.log('ERROR')
                return 'ERROR';
            } else { //ghi thành công mới gửi bản tin phản hồi DCU
                //console.log('GHI FILE THÀNH CÔNG')
            }
        });
    } catch (err) {
        return err;
    }
}
function IEEE_754_convert(bytes) {
    if (bytes == '') {
        return '';
    }
    var bits = (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | (bytes[3]);
    var sign = ((bits >>> 31) == 0) ? 1.0 : -1.0;
    var e = ((bits >>> 23) & 0xff);
    var m = (e == 0) ? (bits & 0x7fffff) << 1 : (bits & 0x7fffff) | 0x800000;
    var f = sign * m * Math.pow(2, e - 150);
    return f.toFixed(2);
}
module.exports.getLength = (data_hex) => {
    var arr_hex = hexString2Array(data_hex);
    var length = arr_hex.length;//length APDU
    return length;
}
function getStringDate() {
    var today = new Date();
    var date = today.getFullYear() + "" + (today.getMonth() + 1) + "" + today.getDate();
    return date;
}

function getStringDate_ghifile() {
    var today = new Date();
    var date = today.getFullYear() + getD2((today.getMonth() + 1)) + getD2(today.getDate());
    var time = getD2(today.getHours()) + getD2(today.getMinutes()) + getD2(today.getSeconds());
    return date + '_' + time;
}

function f_DateTime() {
    var today = new Date();
    var date = getD2(today.getDate()) + '/' + getD2((today.getMonth() + 1)) + '/' + today.getFullYear();
    var time = getD2(today.getHours()) + ':' + getD2(today.getMinutes()) + ':' + getD2(today.getSeconds());
    var dateTime = date + ' ' + time;
    return dateTime;
}

function getD2(str) {
    str = str.toString();
    return str.length < 2 ? getD2("0" + str, 2) : str;
}
function hexString2Array(str) {
    var a = [];
    for (var i = 0, len = str.length; i < len; i += 2) {
        a.push(str.substr(i, 2));
    }
    return a;
}

function byteToHexString(uint8arr) {
    if (!uint8arr) {
        return '';
    }

    var hexStr = '';
    for (var i = 0; i < uint8arr.length; i++) {
        var hex = (uint8arr[i] & 0xff).toString(16);
        hex = (hex.length === 1) ? '0' + hex : hex;
        hexStr += hex + " ";
    }

    return hexStr.toUpperCase();
}

function hexStringToByte(str) {
    if (!str) {
        return new Uint8Array();
    }

    var a = [];
    for (var i = 0, len = str.length; i < len; i += 2) {
        a.push(parseInt(str.substr(i, 2), 16));
    }

    return new Uint8Array(a);
}
function hex2bin(hex) {
    return ("00000000" + hex.toString(2)).substr(-8);
}
