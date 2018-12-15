DROP TABLE IF EXISTS weathers;
DROP TABLE IF EXISTS restaurants;
DROP TABLE IF EXISTS movies;
DROP TABLE IF EXISTS locations;

CREATE TABLE locations (
  id SERIAL PRIMARY KEY,
  search_query VARCHAR (255),
  formatted_query VARCHAR (255),
  latitude NUMERIC (8,6), 
  longitude NUMERIC (9,6)
  );

CREATE TABLE weathers (
  id SERIAL PRIMARY KEY,
  forecast VARCHAR (255),
  time VARCHAR (255),
  location_id INTEGER NOT NULL,
  FOREIGN KEY (location_id) REFERENCES locations(id)
);

CREATE TABLE restaurants (
  id SERIAL PRIMARY KEY,
  name VARCHAR (255),
  image_url VARCHAR (500),
  price VARCHAR (4),
  rating NUMERIC (8,2),
  url VARCHAR (500),
  location_id INTEGER NOT NULL,
  FOREIGN KEY (location_id) REFERENCES locations(id)
);

CREATE TABLE movies (
  id SERIAL PRIMARY KEY,
  title VARCHAR (255),
  overview VARCHAR (500),
  average_votes NUMERIC (4,2),
  total_votes NUMERIC (8, 2),
  image_url VARCHAR (500),
  popularity NUMERIC (4, 2),
  released_on DATE,
  location_id INTEGER NOT NULL,
  FOREIGN KEY (location_id) REFERENCES locations(id)
);