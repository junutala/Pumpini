// Indian states and cities — restricted to South India for Phase 1

export const INDIAN_STATES = [
  'Tamil Nadu',
  'Andhra Pradesh', 
  'Telangana',
  'Karnataka',
  'Maharashtra',
];

export const CITIES_BY_STATE = {
  'Tamil Nadu': [
    'Chennai','Coimbatore','Madurai','Tiruchirappalli','Salem',
    'Tirunelveli','Vellore','Erode','Tiruppur','Dindigul',
    'Thanjavur','Kanchipuram','Cuddalore','Nagercoil','Hosur',
    'Karur','Namakkal','Sivakasi','Thoothukudi','Kumbakonam',
    'Pollachi','Udhagamandalam','Pudukkottai','Ramanathapuram','Virudhunagar'
  ],
  'Andhra Pradesh': [
    'Visakhapatnam','Vijayawada','Guntur','Nellore','Kurnool',
    'Tirupati','Rajamahendravaram','Kakinada','Kadapa','Anantapur',
    'Vizianagaram','Eluru','Nandyal','Ongole','Chittoor',
    'Hindupur','Srikakulam','Bhimavaram','Machilipatnam','Tenali'
  ],
  'Telangana': [
    'Hyderabad','Warangal','Nizamabad','Karimnagar','Khammam',
    'Mahbubnagar','Nalgonda','Adilabad','Suryapet','Siddipet',
    'Mancherial','Jagtial','Kothagudem','Sangareddy','Miryalaguda',
    'Secunderabad','Bodhan','Kamareddy','Tandur','Bhongir'
  ],
  'Karnataka': [
    'Bengaluru','Mysuru','Hubballi','Mangaluru','Belagavi',
    'Davanagere','Ballari','Vijayapura','Shivamogga','Tumkuru',
    'Bidar','Raichur','Dharwad','Udupi','Hassan',
    'Chikkamagaluru','Kolar','Mandya','Bagalkot','Gadag',
    'Koppal','Chikkaballapur','Yadgir','Chamarajanagar','Kodagu'
  ],
  'Maharashtra': [
    'Mumbai','Pune','Nagpur','Nashik','Thane',
    'Aurangabad','Solapur','Kolhapur','Amravati','Navi Mumbai',
    'Sangli','Jalgaon','Akola','Latur','Ahmednagar',
    'Nanded','Satara','Dhule','Chandrapur','Parbhani'
  ],
};

export const getCities = (state) => CITIES_BY_STATE[state] || [];

export const validateMobile = (num) => /^[6-9]\d{9}$/.test(num.replace(/\D/g,''));

export const formatMobile = (num) => {
  const clean = num.replace(/\D/g,'');
  if (clean.length === 10) return `+91${clean}`;
  if (clean.startsWith('91') && clean.length === 12) return `+${clean}`;
  return `+91${clean}`;
};

export const displayMobile = (num) => {
  if (!num) return '';
  return num.replace(/^\+91/,'').replace(/^\+91/,'');
};

export const OIL_COMPANIES = ['HPCL','BPCL','IOC','Essar','Shell','Reliance','Nayara'];

