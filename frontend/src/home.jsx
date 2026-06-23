// Entry for the PUBLIC marketing homepage (smand.co/). Its own bundle —
// completely separate from the staff app at /app/. "Staff Login" is a plain
// navigation to /app/, not a shared component, so the two can never break
// each other and can be rolled out/back independently.
import React from "react";
import ReactDOM from "react-dom/client";
import PublicHome from "./pages/PublicHome.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <PublicHome onStaffLogin={() => { window.location.href = "/app/"; }} />
  </React.StrictMode>
);
