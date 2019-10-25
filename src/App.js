import React from 'react';
import './App.css';
import { geolocated } from 'react-geolocated';
import { getDistance } from 'geolib';

class HttpError extends Error {
    constructor(response) {
        super(`${response.status} for ${response.url}`);
        this.name = 'HttpError';
        this.response = response;
    }
}


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

const ydtQuery = (trpId) => `
{
  trafficData(trafficRegistrationPointId: "${trpId}") {
    volume {
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
class App extends React.Component {

    state = {
        position: null,
        error: null,
        trps: null,
        closestTrp: null
    }

    componentDidMount() {
        fetch('https://www.vegvesen.no/trafikkdata/api/', {
            method: 'post',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            body: JSON.stringify({query: trpQuery})
        })
            .then(res => res.json())
            .then(data => {
                this.onNewTrps(data.data.trafficRegistrationPoints);
            })
            .catch(console.log);
        fetch("https://www.vegvesen.no/nvdb/api/v2/omrader/kommuner.json")
            .then(res => {
                if(res.ok) {
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
        if(trps && this.props.coords) {
            const trpsWithDistance = trps.map(trp => {
                return { trp,
                         distance:
                         getDistance({ latitude: this.props.coords.latitude, longitude: this.props.coords.longitude},
                                     { latitude: trp.location.coordinates.latLon.lat, longitude: trp.location.coordinates.latLon.lon })}});
            const closestTrp = trpsWithDistance.reduce((result, obj) => {
                return (result.distance < obj.distance) ? result : obj;
            });
            this.onNewClosestTrp(closestTrp);
        }
    }

    onNewPosition(position, municipalities) {
        if(position && municipalities) {
            const municipality = municipalities.filter(mun => mun.nummer === position.vegreferanse.kommune)[0];
            this.setState({ municipality });
        }
        this.setState({ position, error: null, municipalities });
    }

    onNewClosestTrp(closestTrp) {
        this.setState({ closestTrp, ydt: null });
        fetch('https://www.vegvesen.no/trafikkdata/api/', {
            method: 'post',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            body: JSON.stringify({query: ydtQuery(closestTrp.trp.id)})
        })
            .then(res => res.json())
            .then((data) => this.onNewYdt(data))
            .catch(console.log);
    }

    onNewYdt(data) {
        const byYear = data.data.trafficData.volume.average.daily.byYear;
        if(byYear.length > 0) {
            this.setState({ ydt: byYear[byYear.length - 1] });
        } else {
            this.setState({ ydt: null });
        }
    }

    componentDidUpdate(prevProps) {
        if(this.props.coords !== prevProps.coords) {
            this.onNewTrps(this.state.trps);
            fetch(`https://www.vegvesen.no/nvdb/api/v2/posisjon?lat=${this.props.coords.latitude}&lon=${this.props.coords.longitude}&maks_avstand=10`)
                .then(res => {
                    if(res.ok) {
                        return res.json();
                    } else {
                        throw new HttpError(res);
                    }
                })
                .then((data) => this.onNewPosition(data[0],
                                                   this.state.municipalities))
                .catch(error => {
                    if(error instanceof HttpError) {
                        error.response.json().then(errorJson => {
                            if(errorJson[0].code === 4012) {
                                this.setState({ position: null,
                                                error: 'For langt fra'});
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

    render () {
        const trp = this.state.closestTrp;
    return (
            <div className="App">
            <h1>Nærmeste vegreferanse og TRP</h1>
            <p>
            {this.state.error}
        </p>
            <p>
            Vegreferanse: {this.state.position && this.state.position.vegreferanse.kortform}
        </p>
            <p>
            Avstand: {this.state.position && this.state.position.avstand}m
        {this.props.coords && (<span> +/- {Math.round(this.props.coords.accuracy)}m</span>)}
        </p>
            <p>
            Kommune: {this.state.municipality && this.state.municipality.navn}
            </p>
            <p>
            TRP: {trp ?
                  (<a href={`http://www.vegvesen.no/trafikkdata/start/kart?trpids=${trp.trp.id}&lat=${trp.trp.location.coordinates.latLon.lat}&lon=${trp.trp.location.coordinates.latLon.lon}&zoom=13`}>{this.state.closestTrp.trp.name}</a>) : ""}
        </p>
            <p>
            Vegreferanse for TRP: {this.state.closestTrp && this.state.closestTrp.trp.location.roadReference.shortForm}
            </p>
            <p>
            Avstand til TRP: {this.state.closestTrp && this.state.closestTrp.distance}m
        </p>
<p>
Siste ÅDT: {this.state.ydt ?
(<span><a href={`https://www.vegvesen.no/trafikkdata/start/utforsk?datatype=averageDailyYearVolume&display=chart&trpids=${this.state.closestTrp.trp.id}`}>{this.state.ydt.total.volume.average}</a> ({this.state.ydt.year}, {Math.round(this.state.ydt.total.coverage.percentage)}% dekningsgrad)</span>)
 : ""}
</p>
        </div>
    );
    }
}

export default geolocated({
    positionOptions: {
        enableHighAccuracy: false,
    },
    userDecisionTimeout: 5000,
    watchPosition: true
})(App);
