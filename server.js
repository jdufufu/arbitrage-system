export default {
  onConnect(connection, room) {
    console.log(`New user connected: ${connection.id}`);

    // Welcome message to the user
    connection.send(JSON.stringify({
      type: "system",
      message: "Connected to Arbitrage System Stream."
    }));

    // Start generating mock streaming updates if the loop isn't already active
    if (!room.intervalId) {
      room.intervalId = setInterval(() => {
        const update = generateArbitrageData();
        room.broadcast(JSON.stringify({
          type: "stream_update",
          data: update
        }));
      }, 2000); // Broadcasts new transaction every 2 seconds
    }
  },

  onClose(connection, room) {
    console.log(`User disconnected: ${connection.id}`);
    
    // Stop the interval if no users are active to conserve resources
    if (room.connections.size === 0 && room.intervalId) {
      clearInterval(room.intervalId);
      room.intervalId = null;
    }
  }
};

// Generates simulated live traffic and arbitrage metrics
function generateArbitrageData() {
  const networks = ["Google Ads", "Meta Ads", "TikTok Ads", "Taboola", "Outbrain", "Bing Ads"];
  const source = networks[Math.floor(Math.random() * networks.length)];
  let destination;
  
  do {
    destination = networks[Math.floor(Math.random() * networks.length)];
  } while (source === destination);

  const cost = (Math.random() * 4 + 0.2).toFixed(2);
  const multiplier = 1.1 + Math.random() * 0.9; // 10% to 100% profit margin
  const revenue = (parseFloat(cost) * multiplier).toFixed(2);
  const profit = (revenue - cost).toFixed(2);
  const roi = ((profit / cost) * 100).toFixed(1);

  return {
    timestamp: new Date().toLocaleTimeString(),
    source,
    destination,
    cost: `$${cost}`,
    revenue: `$${revenue}`,
    profit: `$${profit}`,
    roi: `${roi}%`,
    viewerCount: Math.floor(Math.random() * 120) + 480 // Simulates ~500 live viewers
  };
}
