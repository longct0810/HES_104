'use strict';

// Browser flow v0.2.2.
// getTicket() gọi Web Backend bằng JWT LOGIN hiện tại và nhận một WS ticket RS256 ngắn hạn.
async function connectHesWebSocket(getTicket, deviceIds) {
  const { ticket, wsUrl = 'wss://hes104.ifc.com.vn:6332/ws' } = await getTicket();

  // Ticket không đưa lên query string. hes104-v1 là subprotocol được HES echo lại;
  // ticket.<JWT> chỉ dùng cho handshake và không được HES chọn làm protocol.
  const ws = new WebSocket(wsUrl, [
    'hes104-v1',
    `ticket.${ticket}`,
  ]);

  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);

    if (message?.type === 'READY') {
      ws.send(JSON.stringify({ type: 'SUBSCRIBE', devices: deviceIds }));
      return;
    }

    if (Array.isArray(message)) {
      // Telemetry giữ format legacy:
      // [[ten_thietbi, id_thietbi, IOA, value, time], ...]
      console.log('telemetry', message);
      return;
    }

    console.log('HES message', message);
  });

  return ws;
}

module.exports = { connectHesWebSocket };
