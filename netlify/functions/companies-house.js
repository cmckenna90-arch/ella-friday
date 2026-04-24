const https = require('https');

function chRequest(path, apiKey) {
  return new Promise((resolve) => {
    const auth = Buffer.from(apiKey + ':').toString('base64');
    const req = https.request({
      hostname: 'api.company-information.service.gov.uk',
      path: path,
      method: 'GET',
      headers: {
        'Authorization': 'Basic ' + auth,
        'Accept': 'application/json'
      },
      timeout: 6000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ ok: true, data: JSON.parse(data) }); }
        catch(e) { resolve({ ok: false, error: 'Parse error' }); }
      });
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'Timeout' }); });
    req.end();
  });
}

// Map SIC codes to readable sectors
const SIC_MAP = {
  '62': 'Technology / Software', '63': 'Technology / Data', '64': 'Financial Services',
  '65': 'Insurance', '66': 'Financial Services', '68': 'Real Estate',
  '69': 'Legal / Professional Services', '70': 'Management Consulting',
  '71': 'Architecture / Engineering', '72': 'Research & Development',
  '73': 'Marketing / Advertising', '74': 'Professional Services',
  '78': 'Recruitment / HR', '79': 'Travel & Tourism', '80': 'Security',
  '81': 'Facilities Management', '82': 'Business Administration',
  '85': 'Education', '86': 'Healthcare', '87': 'Residential Care',
  '88': 'Social Work', '90': 'Arts & Entertainment', '91': 'Libraries & Museums',
  '92': 'Gambling', '93': 'Sports & Recreation', '96': 'Personal Services',
  '47': 'Retail', '45': 'Motor Trade', '41': 'Construction', '43': 'Construction',
  '10': 'Food Manufacturing', '55': 'Hotels & Accommodation', '56': 'Restaurants & Food Service',
  '49': 'Transport & Logistics', '52': 'Warehousing & Storage'
};

function getSector(sicCodes) {
  if (!sicCodes || !sicCodes.length) return '';
  const code = String(sicCodes[0]).slice(0, 2);
  return SIC_MAP[code] || '';
}

exports.handler = async function(event) {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  let companyName, apiKey;
  try {
    const body = JSON.parse(event.body);
    companyName = body.companyName;
    apiKey = body.apiKey || process.env.COMPANIES_HOUSE_API_KEY;
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid request' }) };
  }

  if (!apiKey) {
    return { statusCode: 200, headers, body: JSON.stringify({ error: 'No Companies House API key configured', data: null }) };
  }

  // Search for company
  const searchPath = '/search/companies?q=' + encodeURIComponent(companyName) + '&items_per_page=1';
  const searchResult = await chRequest(searchPath, apiKey);

  if (!searchResult.ok || !searchResult.data.items || !searchResult.data.items.length) {
    return { statusCode: 200, headers, body: JSON.stringify({ error: 'Company not found', data: null }) };
  }

  const company = searchResult.data.items[0];
  const companyNumber = company.company_number;

  // Get full company profile
  const profileResult = await chRequest('/company/' + companyNumber, apiKey);
  const profile = profileResult.ok ? profileResult.data : company;

  const address = profile.registered_office_address || {};
  const addressStr = [address.address_line_1, address.address_line_2, address.locality, address.postal_code]
    .filter(Boolean).join(', ');

  const sicCodes = profile.sic_codes || [];
  const sector = getSector(sicCodes);

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      data: {
        companyName: profile.company_name || company.title,
        companyNumber,
        status: profile.company_status,
        incorporated: profile.date_of_creation,
        address: addressStr,
        sicCodes,
        sector,
        type: profile.type
      }
    })
  };
};
