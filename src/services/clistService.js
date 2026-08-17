import axios from 'axios';

const CLIST_API_URL = 'https://clist.by/api/v4/contest/';

export async function fetchUpcomingContests(platforms = [], hoursAhead = 72) {
  if (!platforms || platforms.length === 0) return [];

  const now = new Date();
  const future = new Date(now.getTime() + hoursAhead * 60 * 60 * 1000);

  // 1. SMART CLEANUP: Extracts "codechef.com" out of "codechef (codechef.com)"
  const cleanPlatforms = platforms.map(p => {
    const match = p.match(/\(([^)]+)\)/);
    return match ? match[1].toLowerCase().trim() : p.toLowerCase().trim();
  });

  try {
    // 2. FETCH ALL: We ask CLIST for a big batch of contests without strict host filters
    const response = await axios.get(CLIST_API_URL, {
      headers: {
        'Authorization': `ApiKey ${process.env.CLIST_USERNAME}:${process.env.CLIST_API_KEY}`
      },
      params: {
        upcoming: true,
        start__gte: now.toISOString(),
        start__lte: future.toISOString(),
        order_by: 'start',
        limit: 500 // Grab up to 500 upcoming contests across all platforms
      },
      timeout: 10000
    });

    const allContests = response.data.objects || [];

    // 3. LOCAL FILTERING: We perfectly match them on our own server
    const filteredContests = allContests.filter(contest => {
       // CLIST natively tracks platforms and returns the exact domain in contest.host
       return contest.host && cleanPlatforms.includes(contest.host.toLowerCase());
    });

    return filteredContests;
  } catch (error) {
    console.error('CLIST API Request Error:', error.response?.data || error.message);
    return [];
  }
}