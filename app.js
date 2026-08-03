/**
 * Old app.js file - Redirector to break browser cache and load app_v11.js
 */
(function () {
  console.log("Detecting cached index.html running old app.js. Redirecting to force cache-bust...");
  
  const currentUrl = new URL(window.location.href);
  
  // Add a unique timestamp to force browser to fetch fresh index.html from network
  currentUrl.searchParams.set('v_bust', Date.now());
  
  // Replace the location to bypass cache
  window.location.replace(currentUrl.toString());
})();
