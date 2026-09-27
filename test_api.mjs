const BACKEND_URL = 'http://localhost:3000';
async function run() {
    try {
        console.log("Fetching sectors...");
        const res = await fetch(BACKEND_URL + '/api/fmp/sectors');
        const text = await res.text();
        console.log("Sectors response length:", text.length);
        
        console.log("Fetching movers...");
        const res2 = await fetch(BACKEND_URL + '/api/fmp/movers');
        const text2 = await res2.text();
        console.log("Movers response length:", text2.length);
        
        console.log("Done");
    } catch(e) {
        console.error(e);
    }
}
run();
