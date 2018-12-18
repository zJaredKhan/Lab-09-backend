'use strict';

// Dependencies

const express = require('express');
const cors = require('cors');
const superagent = require('superagent');
const pg = require('pg');

const timeOuts = {
  weather: 15 * 1000,
  meetups: 60 * 60 * 24 * 1000,
  hiking: 30 * 60 * 60 * 24 * 1000,
  yelp: 60 * 24 * 1000
}

require('dotenv').config();

const PORT = process.env.PORT || 3000;



// App

const app = express();

app.use(cors());

//postgres
const client = new pg.Client(process.env.DATABASE_URL);
client.connect();
client.on('error', err => console.error(err));

// New SQL for location
function getLocation(request, response){
  let searchHandler = {
    cacheHit: (data) => {
      console.log('from the database');
      response.status(200).send(data);
    },
    cacheMiss: (query) => {
      return searchLocation(query)
        .then(result => {
          response.send(result);
        }).catch(err=>console.error(err));
    }
  }
  lookForLocation(request.query.data, searchHandler);
}

app.get('/location', getLocation);

function lookForLocation(query, handler) {
  const SQL = 'SELECT * FROM locations WHERE search_query=$1';
  const values = [query];
  console.log(values);
  return client.query(SQL, values)
    .then(data => { //then if we have it, send it back
      if(data.rowCount){
        console.log('Location retrieved from database')
        handler.cacheHit(data.rows[0]);
      } else {//otherwise, get it from google
        handler.cacheMiss(query);
      }
    }).catch(err => console.error(err));
}

function searchLocation(query){
  const URL = `https://maps.googleapis.com/maps/api/geocode/json?address=${query}&key=${process.env.GEOCODE_API_KEY}`;

  return superagent.get(URL)
    .then(result => {
      console.log('Location retrieved from Google')

      //then normalize it
      let location = new Location(result.body.results[0]);
      let SQL = `INSERT INTO locations (search_query, formatted_query, latitude, longitude) VALUES($1, $2, $3, $4) RETURNING id`;


      //store it in our DB
      return client.query(SQL, [query, location.formatted_query, location.latitude, location.longitude])
        .then((result) =>{
          console.log(result);
          console.log('stored to DB');
          location.id = result.rows[0].id
          return location;
          //then send it back

        })
        .catch(err =>
          console.error(err));

    });
}


// New SQL for weather

app.get('/weather', (request, response) => {
  searchWeather(request.query.data)
    .then(forecastData => {
      response.send(forecastData);
    }).catch(err => {
      console.log('HEY YOU!');
      console.error(err);
    })
});

function getWeather(request, response) {
  let searchHandler = {
    cacheHit: (data) => {
      console.log('Weather retrieved from DB');

      let result = data.rows
      response.status(200).send(result);
    },
    cacheMiss: (name, latitude, longitude, id) => {
      return searchWeather(name, latitude, longitude, id)
        .then(result => {
          response.send(result);
        })
        .catch(error => console.log(error));
    },

  };
  let query = request.query.data;
  searchHandler(query.formatted_query, query.latitude, query.longitude, query.id, 'weather', searchHandler);
}

function searchWeather(query){
  const URL = `https://api.darksky.net/forecast/${process.env.DARKSKY_API_KEY}/${query.latitude},${query.longitude}`;

  let SQL = 'SELECT * FROM  weathers WHERE location_id=$1';
  // let values = [request.query.data.id];
  return client.query(SQL, [query.id])

    .then(data =>{
      if(!data.rowCount){ //cache hit
        console.log('Weather retrieved from Api')
        //cache miss

        return superagent.get(URL)
          .then(forecastData => {
            let weeklyForecast = forecastData.body.daily.data.map( forecast => {
              let weatherObject = {};
              weatherObject.forecast = forecast.summary;
              weatherObject.time = new Date(forecast.time * 1000).toDateString();
              // SQL = `INSERT INTO weathers (time, forecast, location_id) VALUES($1, $2, $3)`;
              // values = [weatherObject.time, weatherObject.forecast, request.query.data.id];
              // client.query(SQL, values);
              return weatherObject;

            });

            weeklyForecast.forEach(forecast => {
              SQL = `INSERT INTO weathers (forecast, time, created_at, location_id) VALUES($1, $2, $3, $4)`;
              const values = [forecast.forecast, forecast.time, Date.now(), query.id]
              client.query(SQL, values)
                .catch(err => {
                  console.error(err);
                });
            })
            return weeklyForecast;
            //normalize the data
            // response.status(200).send(weeklyForecast);

          })
          .catch(err => {
            console.error(err);

          })
      } else {
        console.log('found in weather in DB');
        if(Date.now() - data.rows[0].created_at > timeOuts.weather){
          console.log('data too old');
          const SQL = 'DELETE FROM weathers WHERE location_id=$1';
          const values = [query.id];

          return client.query(SQL, values)
            .then(() => {
              return superagent.get(URL)
                .then(forecastData => {
                  let weeklyForecast = forecastData.body.daily.data.map(forecast => {
                    let weatherObject = [];
                    weatherObject.forecast = forecast.summary;
                    weatherObject.time = new Date(forecast.time * 1000).toDateString();
                    return weatherObject;
                  });

                  weeklyForecast.forEach(forecast => {
                    console.log('storing a forecast');
                    const SQL = `INSERT INTO weathers (time, forecast, created_at, location_id) VALUES($1, $2, $3, $4)`;
                    const values = [forecast.forecast, forecast.time, Date.now(), query.id]
                    client.query(SQL, values)
                      .catch(err => {
                        console.error(err);
                      });
                  })
                  return weeklyForecast;
                })
            })

        }
        return data.rows;
      }

    })
}

app.get('/trails', getTrails);
app.get('/meetups', getMeetups);

// app.get('/yelp', (request, response) => {
//   searchRestaurants(request.query.data)
//   .then(yelpData => {
//     response.send(yelpData);
//   }).catch(err => {
//     console.log('HEY YOU!');
//     console.error(err);
//   })
// });

// //Yelp
// function getRestuarants(request, response){
//   let searchHandler = {
//     cacheHit: (data) => {
//       console.log('Yelp retrieved from DB');
//       let result = data.rows;

//       response.status(200).send(result);
//     },
//       cacheMiss: (name, latitude, longitude, id) => {
//         return searchRestaurants(name, latitude, longitude, id)
//           .then(result => {
//             response.send(result);
//           })
//             .catch(error => console.log(error));
//       },
//   };
//   let query = request.query.data;
//   searchHandler(query.formatted_query, query.latitude, query.longitude, query.id, 'restuarants', searchHandler);
// }

// New SQL for Yelp

app.get('/yelp', (request, response) => {
  let SQL = 'SELECT * FROM restaurants WHERE location_id=$1';
  let values = [request.query.data.id];
  client.query(SQL, values)

    .then(data =>{
      if(data.rowCount > 0){ //cache hit
        console.log('Restaurants retrieved from database')
        response.status(200).send(data.rows);
      } else { //cache miss
        let yelpData = `https://api.yelp.com/v3/businesses/search?term=restaurants&latitude=${request.query.data.latitude}&longitude=${request.query.data.longitude}&limit=20`;

        return superagent.get(yelpData)
          // This .set() adds our API KEY
          .set('Authorization', `Bearer ${process.env.YELP_API_KEY}`)
          .then( foodData => {
            let restaurantData = foodData.body.businesses.map( business => {
              let restaurantObject = new Restaurant(business);
              let SQL = `INSERT INTO restaurants (name, image_url, price, rating, url, location_id) VALUES($1, $2, $3, $4, $5, $6)`;
              let values = [restaurantObject.name, restaurantObject.image_url, restaurantObject.price, restaurantObject.rating, restaurantObject.url, request.query.data.id];
              client.query(SQL, values);
              return(restaurantObject);
            })
            //normalize the data
            response.status(200).send(restaurantData);
          })

          .catch(err => {
            console.error(err);
            response.send(err)
          })
      }
    })
    .catch(err => {
      console.error(err);
      response.send(err)
    })
})

//New SQL for Movies

// app.get('/movies', (request, response) => {
//   let SQL = 'SELECT * FROM movies WHERE location_id=$1';
//   let values = [request.query.data.id];
//   client.query(SQL, values)

//     .then(data =>{
//       if(data.rowCount > 0){ //cache hit
//         console.log('Movies retrieved from database')
//         response.status(200).send(data.rows);
//       } else { //cache miss
//         let citySplice = query.formatted_query.split(',');
//         let movieData = `https://api.themoviedb.org/3/search/movie?api_key=${process.env.MOVIES_API_KEY}&query=${citySplice[0]}, ${citySplice[1]}`;

//         return superagent.get(movieData)
//         .then( filmData => {
//           let films = filmData.body.results;//array of results
//           // Sort Films by Popularity
//           films.sort( function (a,b) {
//             if( a.popularity > b.popularity) return -1;
//             if( b.popularity > a.popularity) return 1;
//             return 0;
//           });
//           //If # of films less than 20
//           let numFilms = 20;
//           if(films.length < 20) numFilms = films.length;
//           //For Loop over first 20 films
//           filmArray = [];
//           for(let i = 0 ; i < numFilms ; i++) {
//             //create film objects and push into array.
//             let filmObject = filmArray.push(new Film (films[i]));
//           }
//           let SQL = `INSERT INTO movies (title, overview, average_votes, total_votes, image_url, popularity, released_on, location_id) VALUES($1, $2, $3, $4, $5, $6, $7, $8)`;
//           let values = [filmObject.title, filmObject.overview, filmObject.average_votes, filmObject.image_url, filmObject.popularity, filmObject.released_on, filmObject.location_id];
//           client.query(SQL, values);
//         })

//             //normalize the data
//             response.status(200).send(restaurantData);
//           });



//     .catch(err => {
//       console.error(err);
//       response.send(err)
//     })
// })

//================================ OLD ===============================

// Route

// app.get('/yelp', (req, resp) => {
//   return yelpHandler(req.query.data)
//     .then( (yelp) => {
//       resp.send(yelp);
//     });
// });

app.get('/movies', (req, resp) => {
  return movieHandler(req.query.data)
    .then( (movies) => {
      resp.send(movies);
    });
});

app.get('/*', function(req, resp){
  resp.status(500).send('Don\'t look behind the curtain!!!!!!!!');
});

// Global Variables
let filmArray = [];


// Handlers

// function yelpHandler (query) {
//   let lat = query.latitude;
//   let long = query.longitude;

//   let yelpData = `https://api.yelp.com/v3/businesses/search?term=restaurants&latitude=${lat}&longitude=${long}&limit=20`;

//   return superagent.get(yelpData)
//     // This .set() adds our API KEY
//     .set('Authorization', `Bearer ${process.env.YELP_API_KEY}`)
//     .then( restaurantData => {
//       // The return is a mess that needs to be parsed
//       restaurantData = JSON.parse(restaurantData.text);
//       restaurantData.businesses.map( business => {
//         new Restaurant(business);
//       })
//       return restaurantArray;
//     })
//     .catch( err => {
//       console.error(err)
//     });
// }

function movieHandler (query) {
  let citySplice = query.formatted_query.split(',');
  let movieData = `https://api.themoviedb.org/3/search/movie?api_key=${process.env.MOVIES_API_KEY}&query=${citySplice[0]}, ${citySplice[1]}`;

  return superagent.get(movieData)
    .then( filmData => {
      let films = filmData.body.results;//array of results
      // Sort Films by Popularity
      films.sort( function (a,b) {
        if( a.popularity > b.popularity) return -1;
        if( b.popularity > a.popularity) return 1;
        return 0;
      });
      //If # of films less than 20
      let numFilms = 20;
      if(films.length < 20) numFilms = films.length;
      //For Loop over first 20 films
      filmArray = [];
      for(let i = 0 ; i < numFilms ; i++) {
        //create film objects and push into array.
        filmArray.push(new Film (films[i]));
      }
      return filmArray;
    });
}

function getMeetups(req, res) {
  const meetupOptions = {
    tableName: Meetup.tableName,

    location: req.query.data.id,

    timeout: timeOuts.meetup,

    cacheHit: function(result) {
      res.send(result.rows);
    },

    cacheMiss: function() {
      const url = `https://api.meetup.com/find/groups?location=${req.query.data.search_query}&page=20&key=${process.env.MEETUP_API_KEY}`;

      superagent.get(url)
        .then(results => {
          const meetupSummaries = results.body.map(meetup => {
            const summary = new Meetup(meetup);
            summary.save(req.query.data.id);
            return summary;
          });
          res.send(meetupSummaries);
        })
        .catch(err => handleError(err, res));
    }
  };
  Meetup.lookup(meetupOptions);
}

function getTrails(req, res) {
  const trailOptions = {
    tableName: Trail.tableName,

    location: req.query.data.id,

    timeout: timeouts.trail,

    cacheHit: function(result) {
      res.send(result.rows);
    },

    cacheMiss: function() {
      const url = `https://www.hikingproject.com/data/get-trails?lat=${req.query.data.latitude}&lon=${req.query.data.longitude}&key=${process.env.TRAILS_API_KEY}`;

      superagent.get(url)
        .then(results => {
          const trailSummaries = results.body.trails.map(trail => {
            const summary = new Trail(trail);
            summary.save(req.query.data.id);
            return summary;
          });
          res.send(trailSummaries);
        })
        .catch(err => handleError(err, res));
    }
  };
  Trail.lookup(trailOptions);
}

// Constructors

function Location (location, query) {
  this.search_query = query;
  this.formatted_query = location.formatted_address;
  this.latitude = location.geometry.location.lat;
  this.longitude = location.geometry.location.lng;
}

function Forecast (day) {
  this.forecast = day.summary;
  let date = new Date(day.time * 1000);
  this.time = date.toDateString();
}

function Restaurant (business) {
  this.name = business.name;
  this.image_url = business.image_url;
  this.price = business.price;
  this.rating = business.rating;
  this.url = business.url;
}

function Film (video) {
  this.title = video.title;
  this.overview = video.overview;
  this.average_votes = video.vote_average;
  this.total_votes = video.vote_count;
  this.image_url = 'https://image.tmdb.org/t/p/w200_and_h300_bestv2/' + video.poster_path;
  this.popularity = video.popularity;
  this.released_on = video.release_date;

}

function Trail(trail) {
  this.name = trail.name;
  this.location = trail.location;
  this.length = trail.length;
  this.stars = trail.stars;
  this.star_votes = trail.starVotes;
  this.summary = trail.summary;
  this.trail_url = trail.url;
  this.conditions = trail.conditionStatus;
  this.condition_date = trail.conditionDate.split(' ')[0];
  this.condition_time = trail.conditionDate.split(' ')[1];
}
function Meetup(meetup) {
  this.link = meetup.link;
  this.name = meetup.name;
  this.creation_date = new Date(meetup.created).toDateString();
  this.host = meetup.organizer.name;
}
Meetup.tableName = 'meetups';
Meetup.lookup = lookup;
Meetup.prototype = {
  save: function(location_id) {
    const SQL = `INSERT INTO ${Meetup.tableName} (link, name, creation_date, host, created_at, location_id) VALUES ($1, $2, $3, $4, $5, $6);`;
    const values = [this.link, this.name, this.creation_date, this.host, Date.now(), location_id];
    client.query(SQL, values);
  }
}

Trail.tableName = 'trails';
Trail.lookup = lookup;
Trail.prototype = {
  save: function(location_id) {
    const SQL = `INSERT INTO ${Trail.tableName} (name, location, length, stars, star_votes, summary, trail_url, conditions, condition_date, condition_time, created_at, location_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12);`;
    const values = [this.name, this.location, this.length, this.stars, this.star_votes, this.summary, this.trail_url, this.conditions, this.condition_date, this.condition_time, Date.now(), location_id];

    client.query(SQL, values);
  }
}

// Gobal lookup function except for location
function lookup(options) {
  const SQL = `SELECT * FROM ${options.tableName} WHERE location_id=$1;`;
  const values = [options.location];

  client.query(SQL, values)
    .then(result => {
      if (result.rowCount > 0) {
        if (Date.now() - result.rows[0].created_at > options.timeout) {
          deleteRows(options);
        } else {
          options.cacheHit(result);
        }
      } else {
        options.cacheMiss();
      }
    })
    .catch(error => handleError(error));
}

// Global delete function
function deleteRows(options) {
  const SQL = `DELETE FROM ${options.tableName} WHERE location_id=$1;`;
  const values = [options.location];
  console.log(`cache invalid - deleting rows in ${options.tableName}`)

  client.query(SQL, values)
    .then(() => {
      options.cacheMiss();
    })
    .catch(err => handleError(err));
}
// Checks

app.listen(PORT, () => {
  console.log('app is up on port 3000');
});


//