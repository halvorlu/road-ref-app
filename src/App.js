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
                this.onNewPosition(this.state.position, data.data.trafficRegistrationPoints);
                console.log(data.data.trafficRegistrationPoints);
                this.setState({ trps: data.data.trafficRegistrationPoints});
            })
            .catch(console.log);
    }

    onNewPosition(position, trps) {
        console.log("trps", trps);
        console.log("coords", this.props.coords);
        if(trps && this.props.coords) {
            const trpsWithDistance = trps.map(trp => {
                return { trp,
                         distance:
                                         getDistance({ latitude: this.props.coords.latitude, longitude: this.props.coords.longitude},
                                                     { latitude: trp.location.coordinates.latLon.lat, longitude: trp.location.coordinates.latLon.lon })}});
            const closestTrp = trpsWithDistance.reduce((result, obj) => {
                return (result.distance < obj.distance) ? result : obj;
            });
            console.log("closeset", closestTrp);
            this.setState({ position, error: null, closestTrp });
        } else {
            this.setState({ position, error: null });
        }
    }

    componentDidUpdate(prevProps) {
        console.log(this.props.coords)
        console.log("compdidupdate");
        if(this.props.coords !== prevProps.coords) {
            fetch(`https://www.vegvesen.no/nvdb/api/v2/posisjon?lat=${this.props.coords.latitude}&lon=${this.props.coords.longitude}&maks_avstand=10`)
                .then(res => {
                    if(res.ok) {
                        return res.json();
                    } else {
                        throw new HttpError(res);
                    }
                })
                .then((data) => this.onNewPosition(data[0], this.state.trps))
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
    return (
            <div className="App">
            <h1>Road reference app</h1>
            <p>
            {this.state.error}
        </p>
            <p>
            Vegreferanse: {this.state.position && this.state.position.vegreferanse.kortform}
        </p>
            <p>
            Avstand: {this.state.position && this.state.position.avstand}m
        </p>
            <p>
            Nøyaktighet: {this.props.coords && this.props.coords.accuracy}m
        </p>
            <p>
            TRP: {this.state.closestTrp && this.state.closestTrp.trp.name }
        </p>
            <p>
            Vegreferanse for TRP: {this.state.closestTrp && this.state.closestTrp.trp.location.roadReference.shortForm}
            </p>
            <p>
            Avstand til TRP: {this.state.closestTrp && this.state.closestTrp.distance}m
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
})(App);
