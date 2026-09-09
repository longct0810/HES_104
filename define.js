module.exports.getTypeID = (str) => {
    var type = "";
    switch (str) {
        case 0x01:
            type = "M_SP_NA_1";
            return [type, 1, 0];
        case 0x02:
            type = "M_SP_TA_1";
            return [type, 1,6];
        case 0x03:
            type = "M_DP_NA_1";
            return [type, 1, 0];
        case 0x04:
            type = "M_DP_TA_1";
            return [type, 1,6];
        case 0x5:
            type = "M_ST_NA_1";
            return [type, 1, 1];
        case 0x6:
            type = "M_ST_TA_1";
            return [type, 1];
        case 0x7:
            type = "M_BO_NA_1";
            return [type, 1];
        case 0x8:
            type = "M_BO_TA_1";
            return [type, 1];
        case 0x9:
            type = "M_ME_NA_1";
            return [type, 2, 1];
        case 0x0a:
            type = "M_ME_TA_1";
            return [type, 3];
        case 0x0b:
            type = "M_ME_NB_1";
            return [type, 2, 1];
        case 0x0c:
            type = "M_ME_TB_1";
            return [type, 3];
        case 0x0d:
            type = "M_ME_NC_1";
            return [type, 4, 1];
        case 0x0e:
            type = "M_ME_TC_1";
            return [type, 3];
        case 0x0f:
            type = "M_IT_NA_1";
            return [type, 3];
        case 0x10:
            type = "M_IT_TA_1";
            return [type, 3];
        case 0x11:
            type = "M_EP_TA_1";
            return [type, 3];
        case 0x12:
            type = "M_EP_TB_1";
            return [type, 3];
        case 0x13:
            type = "M_EP_TC_1";
            return [type, 3];
        case 0x14:
            type = "M_PS_NA_1";
            return [type, 3];
        case 0x15:
            type = "M_ME_ND_1";
            return [type, 3];
        case 0x46:
            type = "M_EI_NA_1";//End of initialization 
            return [type, 3];
        case 0x64:
            type = "C_IC_NA_1";//(General-) Interrogation command
            return [type, 3];
        case 0x2d:
            type = "C_SC_NA_1";//(General-) Interrogation command
            return [type, 1,0];
        case 0x2e:
            type = "C_DC_NA_1";//(General-) Interrogation command
            return [type, 1,0];
        default:
            return ["NaN" + str, 0];
    }
}
