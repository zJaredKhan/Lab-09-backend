'use strict';

//Application Dependencies
const express = require('express');
const pg = require('pg');
const cors = require('cors');
const superAgent = require('superagent');

// Calling Date.now() returns the time in milliseconds since Jan 1 1970 00:00:00 UTC
// Multiplying an amount of milliseconds by 1000 achieves 1 second in computer time
// we will have a 15 second cache invalidation
// Darksky api has a request limit of 1000 hits a day
const timeouts = {
  weather: 15 * 1000, //15 seconds
  meetups: 60 * 60 * 24 * 1000 // 24 hours
}

//Load env vars;
require('dotenv').config();

const PORT = process.env.PORT || 3000;
//postgress setup
const client = new pg.Client(process.env.DATABASE_URL);
client.connect();
client.on('error', err => console.error(err));
//app
const app = express();
app.use(cors());
app.get('/location', getLocation);

// Get weather data
app.get('/weather', (request, response) => {
  searchWeather(request.query.data /*|| 'Lynnwood, WA'*/)
    .then(weatherData => {
      response.send(weatherData);
    })
    .catch(err => {
      console.log('========== error from weather ===========')
      console.error(err);
    })
  // console.log(weatherGet);
});
// app.get('/movies', getMov);
// app.get('/yelp', getYelp);

// Get Location data
// help from erin and skyler
function getLocation(request, response){
  let searchHandler = {
    cacheHit: (data) => {
      console.log('from teh dataBass');
      // console.log('getLocation Server data :', data)
      response.status(200).send(data);
    },
    cacheMiss: (query) => {
      return searchLocation(query)
        .then(result => {
          // console.log('getLocation Server data :', result)
          response.send(result);
        }).catch(err=>console.error(err));
    }
  }
  lookForLocation(request.query.data, searchHandler);
}

function lookForLocation (query, handler) {
  const SQL = 'SELECT * FROM locations WHERE search_query=$1';
  const values = [query];
  return client.query(SQL, values)
    .then(data => {
      if(data.rowCount){
        console.log('from teh dataBass');
        handler.cacheHit(data.rows[0]);
      }else {
        handler.cacheMiss(query);
      }
    }).catch(err => console.error(err));
}

function searchLocation (query){
  const URL = `https://maps.googleapis.com/maps/api/geocode/json?address=${query}&key=${process.env.GEOCODE_API_KEY}`;

  return superAgent.get(URL)
    .then(result => {
      console.log('from teh googs');
      let location = new Location(result.body.results[0]);
      let SQL = `INSERT INTO locations 
        (search_query, formatted_query, latitude, longitude)
        VALUES($1, $2, $3, $4)
        RETURNING id`;

      return client.query(SQL, [query, location.formatted_query, location.latitude, location.longitude])
        .then((result) => {
          console.log(result);
          console.log('stored to DB');
          location.id = result.rows[0].id
          return location;//5ends with a sucseful storage
        }).catch(err => console.error(err));
    });
}

function Location(location, query){
  this. search_query = query;
  this.formatted_query = location.formatted_address;
  this.latitude = location.geometry.location.lat;
  this.longitude = location.geometry.location.lng;
}

function searchWeather(query){
  const url = `https://api.darksky.net/forecast/${process.env.DARKSKY_API_KEY}/${query.latitude},${query.longitude}`;
  // body.results.geometry.location. lat || lng
  // console.log(url);
  const SQL = 'SELECT * FROM weathers WHERE location_id=$1'
  return client.query(SQL, [query.id])
    .then(result => {
      if(!result.rowCount){
        console.log('gonna go get stuff from the weather api');
        return superAgent.get(url)
          .then(weatherData => {
            let wArr = weatherData.body.daily.data.map(
              forecast => {
                let data = {};
                data.forecast = forecast.summary;
                data.time = new Date(forecast.time * 1000).toDateString();
                return data;
              }
            );
            // ==================
            //put weather data in the db
            // =====================
            wArr.forEach(forecast => {
              //insert the forecast into DB
              console.log('storing a forecast');
              const SQL = 'INSERT INTO weathers (forecast, time, created_at, location_id) VALUES($1, $2, $3, $4)';
              const values = [forecast.forecast, forecast.time, Date.now(), query.id]
              client.query(SQL, values)
                .catch(err => {
                  console.log('========== error from weather ===========')
                  console.error(err);
                });
            })

            return wArr;
          })
          .catch(err => {
            console.log('========== error from weather ===========')
          })
      } else {
        console.log('found stuff in the db for weather');
        if (Date.now() - result.rows[0].created_at > timeouts.weather ){

          console.log('data too old, invalidating');
          const SQL = 'DELETE FROM weathers WHERE location_id=$1';
          const values=[query.id];

          return client.query(SQL, values)
            .then(() => {
              return superAgent.get(url)
                .then(weatherData => {
                  let wArr = weatherData.body.daily.data.map(
                    forecast => {
                      let data = {};
                      data.forecast = forecast.summary;
                      data.time = new Date(forecast.time * 1000).toDateString();
                      return data;
                    }
                  );
                  // ==================
                  //put weather data in the db
                  // =====================
                  wArr.forEach(forecast => {
                    //insert the forecast into DB
                    console.log('storing a forecast');
                    const SQL = 'INSERT INTO weathers (forecast, time, created_at, location_id) VALUES($1, $2, $3, $4)';
                    const values = [forecast.forecast, forecast.time, Date.now(), query.id]
                    client.query(SQL, values)
                      .catch(err => {
                        console.log('========== error from weather ===========')
                        console.error(err);
                      });
                  })
                  return wArr;
                })
            })


        }
        return result.rows;
      }
    })

  // how to pull lat/long from google API, then format so we can input it into this URL

    .catch(err => {
      console.log('========== error from weather ===========')
      console.error(err)
    });
}

// Error messages
app.get('/*', function(req, res) {
  res.status(404).send('halp, you are in the wrong place');
});

function errorMessage(res, path){
  res.status(500).send('something went wrong. plzfix.');
} //created a function to handle the 500 errors but not sure what to do with it

app.listen(PORT, () => {
  console.log(`app is up on port : ${PORT}`);
});