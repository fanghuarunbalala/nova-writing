package nova.agent.app

import android.app.Application
import nova.agent.app.di.AppContainer

class NovaApplication : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
    }
}
