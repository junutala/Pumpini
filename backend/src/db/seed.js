// src/db/seed.js — Demo seed data
require('dotenv').config();
const pool   = require('./pool');
const bcrypt = require('bcryptjs');

async function seed() {
  const client = await pool.connect();
  try {
    console.log('🌱 Seeding demo data...');
    await client.query('BEGIN');

    // Owner
    const hash = await bcrypt.hash('demo1234', 12);
    const { rows: [owner] } = await client.query(
      `INSERT INTO users(name,phone,email,password_hash,role,language)
       VALUES('Demo Owner','+919999000001','owner@demo.com',$1,'owner','en')
       ON CONFLICT(phone) DO UPDATE SET name=EXCLUDED.name RETURNING id`, [hash]
    );

    // Manager
    const { rows: [manager] } = await client.query(
      `INSERT INTO users(name,phone,password_hash,role,language)
       VALUES('Ravi Kumar','+919999000002',$1,'manager','ta')
       ON CONFLICT(phone) DO UPDATE SET name=EXCLUDED.name RETURNING id`, [hash]
    );

    // Attendants
    const attendantData = [
      ['Arjun S', '+919999000003', 'ta'],
      ['Muthu R', '+919999000004', 'ta'],
      ['Selvam K','+919999000005', 'ta'],
    ];
    const attendants = [];
    for (const [name, phone, lang] of attendantData) {
      const { rows: [a] } = await client.query(
        `INSERT INTO users(name,phone,password_hash,role,language)
         VALUES($1,$2,$3,'attendant',$4)
         ON CONFLICT(phone) DO UPDATE SET name=EXCLUDED.name RETURNING id`,
        [name, phone, hash, lang]
      );
      attendants.push(a);
    }

    // Station
    const { rows: [station] } = await client.query(
      `INSERT INTO stations(name,address,gst_number,oil_company,city,state)
       VALUES('Demo Petrol Station','123 Anna Salai, Chennai','33DEMO0000Z1ZP','HPCL','Chennai','Tamil Nadu')
       ON CONFLICT DO NOTHING RETURNING id`
    );

    if (!station) { console.log('Station already exists, skipping'); await client.query('ROLLBACK'); return; }

    // Assign users to station
    for (const uid of [owner.id, manager.id, ...attendants.map(a => a.id)]) {
      await client.query('INSERT INTO station_users(station_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [station.id, uid]);
    }

    // Tanks
    const tankData = [
      [1, 'petrol',         20000, 15000, 0.7350],
      [2, 'diesel',         25000, 18000, 0.8250],
      [3, 'premium_petrol', 10000,  7500, 0.7420],
    ];
    const tanks = [];
    for (const [num, fuel, cap, stock, density] of tankData) {
      const { rows: [t] } = await client.query(
        `INSERT INTO tanks(station_id,tank_number,fuel_type,capacity_ltrs,current_stock,density)
         VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
        [station.id, num, fuel, cap, stock, density]
      );
      tanks.push({ ...t, fuel_type: fuel });
    }

    // Nozzles (2 per tank)
    const nozzles = [];
    let nozzleNum = 1;
    for (const tank of tanks) {
      for (let i = 0; i < 2; i++) {
        const { rows: [n] } = await client.query(
          `INSERT INTO nozzles(station_id,tank_id,nozzle_number,fuel_type)
           VALUES($1,$2,$3,$4) RETURNING id`,
          [station.id, tank.id, nozzleNum++, tank.fuel_type]
        );
        nozzles.push(n);
      }
    }

    // Fuel prices
    const priceData = [['petrol', 105.50], ['diesel', 93.25], ['premium_petrol', 115.00]];
    for (const [fuel, price] of priceData) {
      await client.query(
        `INSERT INTO fuel_prices(station_id,fuel_type,price,effective_from,set_by) VALUES($1,$2,$3,NOW(),$4)`,
        [station.id, fuel, price, owner.id]
      );
    }

    // RFID tags
    const rfidTags = [];
    for (let i = 0; i < 3; i++) {
      const { rows: [r] } = await client.query(
        `INSERT INTO rfid_tags(tag_uid,station_id) VALUES($1,$2) ON CONFLICT(tag_uid) DO NOTHING RETURNING id`,
        [`DEMO${String(i + 1).padStart(8, '0')}`, station.id]
      );
      if (r) rfidTags.push(r);
    }

    // Corporate account
    const { rows: [corp] } = await client.query(
      `INSERT INTO corporate_accounts(company_name,gst_number,contact_person,contact_phone,contact_email,credit_limit,current_outstanding)
       VALUES('ABC Logistics Pvt Ltd','33ABCDE1234F1Z5','Suresh Babu','+919876543210','suresh@abclogistics.com',200000,45000)
       RETURNING id`
    );

    // Corporate drivers
    const driverData = [
      ['Rajan M', '+919876000001', 'TN09AB1234', 'FT123456', 'BIO001', 5000],
      ['Siva K',  '+919876000002', 'TN09CD5678', 'FT789012', 'BIO002', 8000],
    ];
    for (const [name, phone, vehicle, fasttag, bioref, limit] of driverData) {
      await client.query(
        `INSERT INTO corporate_drivers(corporate_id,name,phone,vehicle_number,fasttag_id,biometric_ref,per_fill_limit)
         VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [corp.id, name, phone, vehicle, fasttag, bioref, limit]
      );
    }

    await client.query('COMMIT');
    console.log('✅  Seed complete!');
    console.log('');
    console.log('── Login credentials ──────────────');
    console.log('Owner:    +919999000001 / demo1234');
    console.log('Manager:  +919999000002 / demo1234');
    console.log('Attendant:+919999000003 / demo1234');
    console.log('───────────────────────────────────');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed error:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
