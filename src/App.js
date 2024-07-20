import "./App.css";
import ChatRoom from "./ChatRoom";
const express = require("express");
function App() {
  const app = express();
  if (process.env.NODE_ENV == "production") {
    app.use(express.static("client/build"));
    const path = require("path");
    app.get("*", (req, res) => {
      res.sendFile(path.resolve(__dirname, "client", "build", "index.html"));
    });
  }
  return (
    <div className="App">
      <ChatRoom />
    </div>
  );
}

export default App;
