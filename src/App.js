import React from 'react';
import './App.css';
import {
  geolocated
} from 'react-geolocated';
import {
  getDistance
} from 'geolib';
import moment from 'moment';

class HttpError extends Error {
  constructor(response) {
    super(`${response.status} for ${response.url}`);
    this.name = 'HttpError';
    this.response = response;
  }
}

const UPDATE_LIMIT_MS = 5000;

const trpQuery = `
{
  trafficRegistrationPoints {
    id
    name
    location {
      roadReference {
        shortForm
      }
      coordinates {
        latLon {
          lat
          lon
        }
      }
    }
  }
}
`

const trafficQuery = (trpId) => {
  const from = new Date();
  from.setDate(from.getDate() - 2);
  const fromText = from.toISOString();
  const to = new Date();
  to.setDate(to.getDate() - 1);
  const toText = to.toISOString();
  return `
{
  trafficData(trafficRegistrationPointId: "${trpId}") {
    volume {
      byDay(from: "${fromText}", to: "${toText}") {
        edges {
          node {
            from
            total {
              volume
              coverage {
                percentage
              }
            }
          }
        }
      }
      average {
        daily {
          byYear {
            year
            total {
              coverage {
                percentage
              }
              volume {
                average
              }
            }
          }
        }
      }
    }
  }
}
`
};

const graphQlQuery = (query) => {
  return fetch('https://www.vegvesen.no/trafikkdata/api/', {
    method: 'post',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      query
    })
  })
    .then(res => res.json());
};

class App extends React.Component {

  state = {
    position: null,
    error: null,
    trps: null,
    closestTrp: null,
    closestTrpDistance: null,
    municipalities: null,
    municipality: null,
    ydt: null,
    dt: null
  }

  constructor() {
    super()
    this.lastUpdate = null;
  }

  componentDidMount() {
    graphQlQuery(trpQuery)
      .then(data => {
        this.onNewTrps(data.data.trafficRegistrationPoints);
      })
      .catch(console.log);
    fetch("https://www.vegvesen.no/nvdb/api/v2/omrader/kommuner.json")
      .then(res => {
        if (res.ok) {
          return res.json();
        } else {
          throw new HttpError(res);
        }
      })
      .then((data) => this.onNewPosition(this.state.position,
        data))
      .catch(console.log);
  }

  onNewTrps(trps) {
    this.setState({
      trps: trps
    });
    if (trps && this.props.coords) {
      const trpsWithDistance = trps.map(trp => {
        return {
          trp,
          distance: getDistance({
            latitude: this.props.coords.latitude,
            longitude: this.props.coords.longitude
          }, {
            latitude: trp.location.coordinates.latLon.lat,
            longitude: trp.location.coordinates.latLon.lon
          })
        };
      });
      const closestTrp = trpsWithDistance.reduce((result, obj) => {
        return (result.distance < obj.distance) ? result : obj;
      });
      this.setState({
        closestTrpDistance: closestTrp.distance
      });
      if (this.state.closestTrp == null ||
        this.state.closestTrp.id !== closestTrp.trp.id) {
        this.onNewClosestTrp(closestTrp.trp);
      }
    }
  }

  onNewPosition(position, municipalities) {
    if (position && municipalities) {
      const municipality = municipalities.filter(mun => mun.nummer ===
        position.vegreferanse.kommune)[0];
      this.setState({
        municipality
      });
    }
    this.setState({
      position,
      error: null,
      municipalities
    });
  }

  onNewClosestTrp(closestTrp) {
    this.setState({
      closestTrp,
      ydt: null
    });
    graphQlQuery(trafficQuery(closestTrp.id))
      .then((data) => this.onNewTraffic(data))
      .catch(console.log);
  }

  onNewTraffic(data) {
    const byYear = data.data.trafficData.volume.average.daily.byYear;
    if (byYear.length > 0) {
      this.setState({
        ydt: byYear[byYear.length - 1]
      });
    } else {
      this.setState({
        ydt: null
      });
    }
    const byDayEdges = data.data.trafficData.volume.byDay.edges;
    if (byDayEdges.length > 0) {
      this.setState({
        dt: byDayEdges[0].node
      });
    } else {
      this.setState({
        dt: null
      });
    }
  }

  componentDidUpdate(prevProps) {
    const now = new Date();
    if (this.props.coords !== prevProps.coords &&
      (this.lastUpdate == null ||
        now.getTime() - this.lastUpdate.getTime() > UPDATE_LIMIT_MS)) {
      this.lastUpdate = now;
      this.onNewTrps(this.state.trps);
      fetch(
        `https://www.vegvesen.no/nvdb/api/v2/posisjon?lat=${this.props.coords.latitude}&lon=${this.props.coords.longitude}&maks_avstand=200`
      )
        .then(res => {
          if (res.ok) {
            return res.json();
          } else {
            throw new HttpError(res);
          }
        })
        .then((data) => this.onNewPosition(data[0],
          this.state.municipalities))
        .catch(error => {
          if (error instanceof HttpError) {
            error.response.json()
              .then(errorJson => {
                if (errorJson[0].code === 4012) {
                  this.setState({
                    position: null,
                    error: 'Ingen vegreferanser i nærheten'
                  });
                } else {
                  console.log(errorJson);
                }
              });
          } else {
            console.log(error);
          }
        });
    }
  }

  render() {
    const trp = this.state.closestTrp;
    return (
      <div className="App">
        <h2>Nærmeste vegreferanse</h2>
        <table className="center">
          <tr>
            <td></td><td>{this.state.error}</td>
          </tr>
          <tr>
            <td>Vegreferanse:</td><td>{this.state.position && this.state.position.vegreferanse.kortform}</td>
          </tr>
          <tr>
            <td>Avstand: </td><td>{this.state.position && this.state.position.avstand}m
        {this.props.coords && (<span> +/- {Math.round(this.props.coords.accuracy)}m</span>)}
            </td>
          </tr>
          <tr>
            <td>Posisjon sist oppdatert:</td><td>{moment(this.lastUpdate).format('YYYY-MM-DD hh:mm:ss')}</td>
          </tr>
        </table>
        <h2>Nærmeste TRP</h2>
        <table className="center">
        <tr>
          <td>Navn:</td><td>{trp ?
            (<a href={`http://www.vegvesen.no/trafikkdata/start/kart?trpids=${trp.id}&lat=${trp.location.coordinates.latLon.lat}&lon=${trp.location.coordinates.latLon.lon}&zoom=13`}>{trp.name}</a>) : ""}</td>
        </tr>
        <tr>
          <td>Vegreferanse:</td><td>{trp && trp.location.roadReference.shortForm}</td>
        </tr>
        <tr>
          <td>Avstand:</td><td>{this.state.closestTrpDistance}m</td>
        </tr>
        <tr>
          <td>Siste ÅDT:</td><td>{trp && this.state.ydt ?
            (<span><a href={`https://www.vegvesen.no/trafikkdata/start/utforsk?datatype=averageDailyYearVolume&display=chart&trpids=${trp.id}`}>{this.state.ydt.total.volume.average}</a> ({this.state.ydt.year}, {Math.round(this.state.ydt.total.coverage.percentage)}% dekningsgrad)</span>)
            : ""}</td>
        </tr>
        <tr>
          <td>Trafikk siste dag:</td><td>{trp && this.state.dt ?
            this.renderDayTraffic()
            : ""}</td>
        </tr>
        </table>
      </div>
    );
  }

  renderDayTraffic() {
    const trp = this.state.closestTrp;
    const fromDate = this.state.dt.from.split('T')[0];
    return (
      <span><a href={`https://www.vegvesen.no/trafikkdata/start/utforsk?datatype=weekVolume&display=chart&trpids=${trp.id}&from=${fromDate}`}>{this.state.dt.total.volume}</a> ({fromDate}, {Math.round(this.state.dt.total.coverage.percentage)}% dekningsgrad)</span>
    );
  }
}

export default geolocated({
  positionOptions: {
    enableHighAccuracy: true,
    maximumAge: UPDATE_LIMIT_MS
  },
  userDecisionTimeout: 5000,
  watchPosition: true
})(App);
