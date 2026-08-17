import axios from 'axios';

const CLIST_API_URL = 'https://clist.by/api/v4/contest/';

export async function fetchUpcomingContests(platforms = [], hoursAhead = 72) {
  if (!platforms || platforms.length === 0) return [];

  const now = new Date();
  const future = new Date(now.getTime() + hoursAhead * 60 * 60 * 1000);

  try {
    const response = await axios.get(CLIST_API_URL, {
      headers: {
        'Authorization': `ApiKey ${process.env.CLIST_USERNAME}:${process.env.CLIST_API_KEY}`
      },
      params: {
        upcoming: true,
        start__gte: now.toISOString(),
        start__lte: future.toISOString(),
        order_by: 'start',
        // FIX: Changed from 'host__in' to 'resource__host__in' to properly filter multiple domains
        resource__host__in: platforms.join(','),
        limit: 100
      },
      timeout: 10000
    });

    return response.data.objects || [];
  } catch (error) {
    console.error('CLIST API Request Error:', error.response?.data || error.message);
    return [];
  }
}